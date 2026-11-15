import express, { Request, RequestHandler, Response, Router } from 'express';
import type { DataStorePlugin, Receipt } from '@cognitiveproof/softbinding-api-plugin-types';
import { AuthRequiredCheck, createReadAuthGate, requireAuthScope } from '../auth';
import { verifyReceipt } from '../receipts';

export interface FetchRouterDeps {
  dataStore: DataStorePlugin;
  auth: RequestHandler;
  /** Non-failing auth check — populates AuthContext when available, never rejects. */
  optionalAuth: RequestHandler;
  receiptSecret: string;
  /** See SoftBindingServerOptions.isAuthRequired.manifests. */
  isManifestAuthRequired?: AuthRequiredCheck<string>;
  /** See SoftBindingServerOptions.isAuthRequired.receipts. */
  isReceiptAuthRequired?: AuthRequiredCheck<string>;
  /** See SoftBindingServerOptions.manifestHtmlRedirect. */
  manifestHtmlRedirect?: (manifestId: string) => string;
}

function acceptsHtml(req: Request): boolean {
  const accept = req.headers.accept;
  return typeof accept === 'string' && accept.includes('text/html');
}

export function createFetchRouter(deps: FetchRouterDeps): Router {
  const { dataStore, auth, optionalAuth, receiptSecret } = deps;
  const { isManifestAuthRequired, isReceiptAuthRequired, manifestHtmlRedirect } = deps;
  const router = express.Router();
  const requireFetchScope = requireAuthScope('fetch:manifests');
  const manifestIdParam = (req: Request) => req.params.manifestId;

  // Redirects browser navigations (Accept: text/html) to manifestHtmlRedirect's
  // URL for the requested manifestId, before auth or the manifest lookup run —
  // it doesn't check existence or authorization, just the Accept header.
  const htmlRedirect: RequestHandler = (req, res, next) => {
    if (manifestHtmlRedirect && acceptsHtml(req)) {
      return res.redirect(303, manifestHtmlRedirect(req.params.manifestId));
    }
    next();
  };

  // GET /manifests/:manifestId
  // Returns the full C2PA Manifest Store (or only the active manifest if requested).
  //
  // Without isAuthRequired.manifests, this is gated exactly like every other
  // route (mandatory `auth` + `fetch:manifests` scope, 401/403 as usual).
  // With it, a caller who needs auth and fails it gets the same 404 as a
  // nonexistent manifest, so a private manifest's existence isn't revealed.
  const manifestAuthChain = createReadAuthGate({
    check: isManifestAuthRequired,
    auth,
    optionalAuth,
    requireScope: requireFetchScope,
    resource: manifestIdParam,
    notFound: { error: 'C2PA Manifest not found' },
  });
  const receiptAuthChain = createReadAuthGate({
    check: isReceiptAuthRequired,
    auth,
    optionalAuth,
    requireScope: requireFetchScope,
    resource: manifestIdParam,
  });

  router.get(
    '/manifests/:manifestId',
    htmlRedirect,
    ...manifestAuthChain,
    async (req: Request, res: Response) => {
      const { manifestId } = req.params;

      try {
        const entry = await dataStore.getManifest(manifestId);
        if (!entry) {
          return res.status(404).json({ error: 'C2PA Manifest not found' });
        }

        // In a real implementation with returnActiveManifest=true you would parse
        // the CBOR-encoded C2PA Manifest Store and return only the active manifest.
        // Here we return the full blob regardless, as parsing requires a C2PA library.
        res.set('Content-Type', 'application/c2pa');
        return res.send(entry.data);
      } catch {
        return res.status(500).json({ error: 'Service failure' });
      }
    },
  );

  // GET /manifests/:manifestId/receipts  — fetch the stored receipt + verification status
  router.get(
    '/manifests/:manifestId/receipts',
    ...receiptAuthChain,
    async (req: Request, res: Response) => {
      const { manifestId } = req.params;
      try {
        if (!(await dataStore.manifestExists(manifestId))) {
          return res.status(404).json({ error: 'C2PA Manifest Store or receipt not found' });
        }

        const receipt = await dataStore.getReceipt(manifestId);
        if (!receipt) {
          return res.status(404).json({ error: 'C2PA Manifest Store or receipt not found' });
        }

        const verified =
          receipt.repository?.manifestId === manifestId && verifyReceipt(receipt, receiptSecret);
        return res.json({ ...receipt, verified });
      } catch {
        return res.status(500).json({ error: 'Service failure' });
      }
    },
  );

  // POST /manifests/:manifestId/receipts  — verify a caller-supplied receipt
  router.post(
    '/manifests/:manifestId/receipts',
    ...receiptAuthChain,
    async (req: Request, res: Response) => {
      const { manifestId } = req.params;
      const receipt = req.body as Receipt | undefined;

      if (!receipt || receipt['@type'] !== 'org.c2pa.manifest-receipt') {
        return res.status(400).json({ error: 'Invalid receipt: missing or wrong @type' });
      }

      try {
        if (!(await dataStore.manifestExists(manifestId))) {
          return res.status(404).json({ error: 'C2PA Manifest not found' });
        }
        if (receipt.repository?.manifestId !== manifestId) {
          return res.status(400).json({
            ...receipt,
            verified: false,
            error: 'The supplied receipt manifestId does not match the requested manifestId',
          });
        }

        const verified = verifyReceipt(receipt, receiptSecret);
        return res.json({
          ...receipt,
          verified,
          ...(verified ? {} : { error: 'Receipt proof verification failed' }),
        });
      } catch {
        return res.status(500).json({ error: 'Service failure' });
      }
    },
  );

  return router;
}
