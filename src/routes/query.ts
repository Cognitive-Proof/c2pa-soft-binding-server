import express, { Request, RequestHandler, Response, Router } from 'express';
import type { DataStorePlugin } from '@cognitiveproof/softbinding-api-plugin-types';
import type { SoftBindingRegistry } from '../softBinding';
import { requireAuthScope } from '../auth';
import { validateReferenceUrl } from '../utils/ssrf';

const ASSET_MIME_RE = /^(image|audio|video|application|model|text)\//;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REFERENCE_REDIRECTS = 5;
const REFERENCE_TIMEOUT_MS = 30_000;

class ReferenceSizeError extends Error {}

async function readBoundedBody(response: globalThis.Response, maxBytes: number): Promise<Buffer> {
  if (!response.body) return Buffer.alloc(0);

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        throw new ReferenceSizeError(`Remote asset exceeds the server limit of ${maxBytes} bytes`);
      }
      chunks.push(Buffer.from(value));
    }
  } catch (err) {
    await reader.cancel().catch(() => undefined);
    throw err;
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks, totalBytes);
}

async function fetchValidatedReference(
  initialUrl: string,
  init: RequestInit,
): Promise<globalThis.Response> {
  let currentUrl = initialUrl;

  for (let redirectCount = 0; redirectCount <= MAX_REFERENCE_REDIRECTS; redirectCount += 1) {
    await validateReferenceUrl(currentUrl);

    const response = await fetch(currentUrl, { ...init, redirect: 'manual' });
    if (!REDIRECT_STATUSES.has(response.status)) return response;

    const location = response.headers.get('location');
    if (!location) return response;
    if (redirectCount === MAX_REFERENCE_REDIRECTS) {
      await response.body?.cancel();
      throw new Error(`Reference URL exceeded ${MAX_REFERENCE_REDIRECTS} redirects`);
    }

    let redirectUrl: string;
    try {
      redirectUrl = new URL(location, currentUrl).toString();
    } catch {
      await response.body?.cancel();
      throw new Error('Reference URL returned an invalid redirect location');
    }

    await response.body?.cancel();
    currentUrl = redirectUrl;
  }

  throw new Error(`Reference URL exceeded ${MAX_REFERENCE_REDIRECTS} redirects`);
}

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
  const requireFetchScope = requireAuthScope('fetch:manifests');

  // Body parser for raw binary assets (byContent route)
  const rawAsset = express.raw({
    type: (req) => ASSET_MIME_RE.test(req.headers['content-type'] ?? ''),
    limit: maxUploadSize,
  });

  // GET /matches/byBinding
  router.get('/matches/byBinding', auth, requireFetchScope, async (req: Request, res: Response) => {
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
  router.post(
    '/matches/byBinding',
    auth,
    requireFetchScope,
    async (req: Request, res: Response) => {
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
    },
  );

  // POST /matches/byContent  (raw binary asset upload)
  router.post(
    '/matches/byContent',
    auth,
    requireFetchScope,
    rawAsset,
    async (req: Request, res: Response) => {
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
    },
  );

  // POST /matches/byReference  (server downloads the asset — optional endpoint)
  router.post(
    '/matches/byReference',
    auth,
    requireFetchScope,
    async (req: Request, res: Response) => {
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

      const controller = new AbortController();
      try {
        const timeout = setTimeout(() => controller.abort(), REFERENCE_TIMEOUT_MS);

        try {
          const response = await fetchValidatedReference(referenceUrl, {
            signal: controller.signal,
            headers: assetType ? { Accept: assetType } : {},
          });

          if (!response.ok) {
            await response.body?.cancel();
            return res.status(502).json({ error: 'Failed to fetch reference URL' });
          }

          const contentLength = Number(response.headers.get('content-length') ?? 0);
          if (contentLength > maxReferenceSize) {
            await response.body?.cancel();
            return res.status(400).json({
              error: `Remote asset exceeds the server limit of ${maxReferenceSize} bytes`,
            });
          }

          // Verify the downloaded content type matches what the caller declared
          const downloadedType = (response.headers.get('content-type') ?? '').split(';')[0].trim();
          if (assetType && !downloadedType.startsWith(assetType.split('/')[0])) {
            await response.body?.cancel();
            return res
              .status(400)
              .json({ error: 'Downloaded asset MIME type does not match assetType' });
          }

          const buffer = await readBoundedBody(response, maxReferenceSize);
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
        } finally {
          clearTimeout(timeout);
        }
      } catch (err) {
        if (err instanceof ReferenceSizeError) {
          return res.status(400).json({ error: err.message });
        }
        if (controller.signal.aborted || (err instanceof Error && err.name === 'AbortError')) {
          return res.status(504).json({ error: 'Reference download timed out' });
        }
        if (err instanceof Error) {
          const ssrfMsg = ['URL', 'HTTPS', 'IP', 'hostname'].some((k) => err.message.includes(k));
          if (ssrfMsg) return res.status(400).json({ error: err.message });
        }
        return res.status(500).json({ error: 'Service failure' });
      }
    },
  );

  return router;
}
