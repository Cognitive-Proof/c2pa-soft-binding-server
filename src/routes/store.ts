import express, { Request, RequestHandler, Response, Router } from 'express';
import type { DataStorePlugin, Receipt } from '@cognitiveproof/softbinding-api-plugin-types';
import { requireAuthScope } from '../auth';
import { buildReceipt } from '../receipts';

export interface StoreRouterDeps {
  dataStore: DataStorePlugin;
  auth: RequestHandler;
  repoUri: string;
  receiptSecret: string;
  parseManifestId?: (data: Buffer) => string | Promise<string>;
}

export function createStoreRouter(deps: StoreRouterDeps): Router {
  const { dataStore, auth, repoUri, receiptSecret, parseManifestId } = deps;
  const router = express.Router();
  const requireManifestScope = requireAuthScope('store:manifests');
  const requireBindingScope = requireAuthScope('store:bindings');

  // Body parser for C2PA Manifest Store blobs
  const c2paBody = express.raw({ type: 'application/c2pa', limit: '100mb' });

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

      const data = req.body as Buffer;
      let parsedId: string | undefined;

      if (parseManifestId) {
        try {
          parsedId = await parseManifestId(data);
        } catch (err) {
          return res.status(400).json({
            error: `Failed to parse manifest id: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      }

      try {
        let manifestId: string;

        if (parsedId) {
          // Existence + byte-comparison check happens here rather than
          // atomically inside addManifest — see the plugin interface doc
          // comment for why a same-id-different-bytes upload is treated as
          // a label conflict (400) rather than silently overwritten. Two
          // concurrent uploads racing to claim the same brand-new id is a
          // theoretical (not practical) gap given manifest ids are UUIDs.
          const existing = await dataStore.getManifest(parsedId);
          if (existing) {
            if (Buffer.compare(existing.data, data) !== 0) {
              return res.status(400).json({
                error: `manifestId ${parsedId} is already in use by a different manifest`,
              });
            }
            manifestId = parsedId;
          } else {
            manifestId = await dataStore.addManifest(data, 'application/c2pa', parsedId);
          }
        } else {
          manifestId = await dataStore.addManifest(data, 'application/c2pa');
        }

        const result: { manifestId: string; receipt?: Receipt } = { manifestId };

        if (returnReceipt) {
          const receipt = buildReceipt(manifestId, repoUri, receiptSecret);
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
