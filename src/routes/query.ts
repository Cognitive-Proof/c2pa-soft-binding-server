import express, { Request, RequestHandler, Response, Router } from 'express';
import type { DataStorePlugin } from '@cognitiveproof/softbinding-api-plugin-types';
import type { SoftBindingRegistry } from '../softBinding';
import { validateReferenceUrl } from '../utils/ssrf';

const ASSET_MIME_RE = /^(image|audio|video|application|model|text)\//;

export interface QueryRouterDeps {
  dataStore: DataStorePlugin;
  softBinding: SoftBindingRegistry;
  auth: RequestHandler;
  maxUploadSize: number;
  maxReferenceSize: number;
}

export function createQueryRouter(deps: QueryRouterDeps): Router {
  const { dataStore, softBinding, auth, maxUploadSize, maxReferenceSize } = deps;
  const router = express.Router();

  // Body parser for raw binary assets (byContent route)
  const rawAsset = express.raw({
    type: req => ASSET_MIME_RE.test(req.headers['content-type'] ?? ''),
    limit: maxUploadSize,
  });

  // GET /matches/byBinding
  router.get('/matches/byBinding', auth, async (req: Request, res: Response) => {
    const { value, alg } = req.query as Record<string, string | undefined>;
    const maxResults = parseInt((req.query.maxResults as string) ?? '10', 10);

    if (!value || !alg) {
      return res.status(400).json({ error: 'Missing required query parameters: value, alg' });
    }
    if (isNaN(maxResults) || maxResults < 1) {
      return res.status(400).json({ error: 'maxResults must be a positive integer' });
    }

    try {
      return res.json({ matches: await dataStore.findByBinding(value, maxResults) });
    } catch {
      return res.status(500).json({ error: 'Service failure' });
    }
  });

  // POST /matches/byBinding  (for large binding values that don't fit in a URL)
  router.post('/matches/byBinding', auth, async (req: Request, res: Response) => {
    const { value, alg } = (req.body ?? {}) as Record<string, string | undefined>;
    const maxResults = parseInt((req.query.maxResults as string) ?? '10', 10);

    if (!value || !alg) {
      return res.status(400).json({ error: 'Request body must include value and alg' });
    }
    if (isNaN(maxResults) || maxResults < 1) {
      return res.status(400).json({ error: 'maxResults must be a positive integer' });
    }

    try {
      return res.json({ matches: await dataStore.findByBinding(value, maxResults) });
    } catch {
      return res.status(500).json({ error: 'Service failure' });
    }
  });

  // POST /matches/byContent  (raw binary asset upload)
  router.post('/matches/byContent', auth, rawAsset, async (req: Request, res: Response) => {
    const contentType = req.headers['content-type'] ?? '';
    const alg = req.query.alg as string | undefined;
    const hintAlg = req.query.hintAlg as string | undefined;
    const hintValue = req.query.hintValue as string | undefined;
    const maxResults = parseInt((req.query.maxResults as string) ?? '10', 10);

    if (!ASSET_MIME_RE.test(contentType)) {
      return res.status(415).json({ error: 'Unsupported asset type' });
    }
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: 'Empty or missing asset body' });
    }
    if (isNaN(maxResults) || maxResults < 1) {
      return res.status(400).json({ error: 'maxResults must be a positive integer' });
    }

    try {
      let bindingValue: string | null = null;

      if (alg) {
        bindingValue = await softBinding.extractSoftBinding(req.body as Buffer, contentType, alg);
      }
      // Fall back to caller-supplied hint if extraction returns nothing
      if (!bindingValue && hintAlg && hintValue) {
        bindingValue = hintValue;
      }

      if (!bindingValue) {
        return res.json({ matches: [] });
      }
      return res.json({ matches: await dataStore.findByBinding(bindingValue, maxResults) });
    } catch {
      return res.status(500).json({ error: 'Service failure' });
    }
  });

  // POST /matches/byReference  (server downloads the asset — optional endpoint)
  router.post('/matches/byReference', auth, async (req: Request, res: Response) => {
    const { referenceUrl, assetLength, assetType } = (req.body ?? {}) as {
      referenceUrl?: string;
      assetLength?: number;
      assetType?: string;
      region?: unknown;
    };
    const alg = req.query.alg as string | undefined;
    const hintAlg = req.query.hintAlg as string | undefined;
    const hintValue = req.query.hintValue as string | undefined;
    const maxResults = parseInt((req.query.maxResults as string) ?? '10', 10);

    if (!referenceUrl || assetLength == null) {
      return res.status(400).json({ error: 'referenceUrl and assetLength are required' });
    }
    if (isNaN(maxResults) || maxResults < 1) {
      return res.status(400).json({ error: 'maxResults must be a positive integer' });
    }
    if (assetLength > maxReferenceSize) {
      return res
        .status(400)
        .json({ error: `assetLength exceeds the server limit of ${maxReferenceSize} bytes` });
    }

    try {
      await validateReferenceUrl(referenceUrl);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30_000);

      let response: globalThis.Response;
      try {
        response = await fetch(referenceUrl, {
          signal: controller.signal,
          headers: assetType ? { Accept: assetType } : {},
        });
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        return res.status(502).json({ error: 'Failed to fetch reference URL' });
      }

      const contentLength = Number(response.headers.get('content-length') ?? 0);
      if (contentLength > maxReferenceSize) {
        return res
          .status(400)
          .json({ error: `Remote asset exceeds the server limit of ${maxReferenceSize} bytes` });
      }

      // Verify the downloaded content type matches what the caller declared
      const downloadedType = (response.headers.get('content-type') ?? '').split(';')[0].trim();
      if (assetType && !downloadedType.startsWith(assetType.split('/')[0])) {
        return res
          .status(400)
          .json({ error: 'Downloaded asset MIME type does not match assetType' });
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      const effectiveType = assetType ?? downloadedType ?? 'application/octet-stream';

      let bindingValue: string | null = null;
      if (alg) {
        bindingValue = await softBinding.extractSoftBinding(buffer, effectiveType, alg);
      }
      if (!bindingValue && hintAlg && hintValue) {
        bindingValue = hintValue;
      }

      if (!bindingValue) {
        return res.json({ matches: [] });
      }
      return res.json({ matches: await dataStore.findByBinding(bindingValue, maxResults) });
    } catch (err) {
      if (err instanceof Error) {
        const ssrfMsg = ['URL', 'HTTPS', 'IP', 'hostname'].some(k => err.message.includes(k));
        if (ssrfMsg) return res.status(400).json({ error: err.message });
      }
      return res.status(500).json({ error: 'Service failure' });
    }
  });

  return router;
}
