import express, { Request, RequestHandler, Response, Router } from 'express';
import crypto from 'crypto';
import type { DataStorePlugin, Receipt } from '@cognitiveproof/softbinding-api-plugin-types';
import { requireAuthScope } from '../auth';

export interface StoreRouterDeps {
  dataStore: DataStorePlugin;
  auth: RequestHandler;
  repoUri: string;
  receiptSecret: string;
}

export function createStoreRouter(deps: StoreRouterDeps): Router {
  const { dataStore, auth, repoUri, receiptSecret } = deps;
  const router = express.Router();
  const requireManifestScope = requireAuthScope('store:manifests');
  const requireBindingScope = requireAuthScope('store:bindings');

  // Body parser for C2PA Manifest Store blobs
  const c2paBody = express.raw({ type: 'application/c2pa', limit: '100mb' });

  function buildReceipt(manifestId: string): Receipt {
    const proof = crypto.createHmac('sha256', receiptSecret).update(manifestId).digest('base64url');

    return {
      '@context': {
        c2pa: 'https://c2pa.org/ns/',
        receipt: 'https://c2pa.org/ns/manifest-receipt#',
      },
      '@type': 'org.c2pa.manifest-receipt',
      repository: {
        uri: repoUri,
        manifestId,
      },
      anchor: {
        uri: `${repoUri}/v1/manifests/${encodeURIComponent(manifestId)}/receipts`,
        proof: {
          alg: 'HMAC-SHA256',
          value: proof,
        },
      },
    };
  }

  // POST /manifests  — ingest a C2PA Manifest Store
  router.post(
    '/manifests',
    auth,
    requireManifestScope,
    c2paBody,
    async (req: Request, res: Response) => {
      const returnReceipt = req.query.returnReceipt === 'true';

      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        return res
          .status(400)
          .json({ error: 'Request body must be a non-empty application/c2pa blob' });
      }

      try {
        const manifestId = await dataStore.addManifest(req.body as Buffer, 'application/c2pa');
        const result: { manifestId: string; receipt?: Receipt } = { manifestId };

        if (returnReceipt) {
          const receipt = buildReceipt(manifestId);
          await dataStore.setReceipt(manifestId, receipt);
          result.receipt = receipt;
        }

        return res.status(200).json(result);
      } catch {
        return res.status(500).json({ error: 'Service failure' });
      }
    },
  );

  // POST /bindings  — associate a soft binding value with a stored manifest
  router.post('/bindings', auth, requireBindingScope, async (req: Request, res: Response) => {
    const { bindingValue, manifestId } = (req.body ?? {}) as Record<string, string | undefined>;

    if (!bindingValue || !manifestId) {
      return res.status(400).json({ error: 'bindingValue and manifestId are required' });
    }

    try {
      const created = await dataStore.createBinding(bindingValue, manifestId);
      if (!created) {
        return res.status(404).json({ error: 'Soft binding id or C2PA Manifest id not found' });
      }
      return res.status(204).send();
    } catch {
      return res.status(500).json({ error: 'Service failure' });
    }
  });

  // PUT /bindings  — replace an existing soft binding's manifest pointer
  router.put('/bindings', auth, requireBindingScope, async (req: Request, res: Response) => {
    const { bindingValue, manifestId } = (req.body ?? {}) as Record<string, string | undefined>;

    if (!bindingValue || !manifestId) {
      return res.status(400).json({ error: 'bindingValue and manifestId are required' });
    }

    try {
      const ok = await dataStore.updateBinding(bindingValue, manifestId);
      if (!ok) {
        return res.status(404).json({ error: 'Soft binding value not found' });
      }
      return res.status(204).send();
    } catch {
      return res.status(500).json({ error: 'Service failure' });
    }
  });

  // DELETE /manifests/:manifestId  — remove a manifest and its bindings
  router.delete(
    '/manifests/:manifestId',
    auth,
    requireManifestScope,
    async (req: Request, res: Response) => {
      try {
        const ok = await dataStore.deleteManifest(req.params.manifestId);
        if (!ok) {
          return res.status(404).json({ error: 'C2PA Manifest Store not found' });
        }
        return res.status(204).send();
      } catch {
        return res.status(500).json({ error: 'Service failure' });
      }
    },
  );

  return router;
}
