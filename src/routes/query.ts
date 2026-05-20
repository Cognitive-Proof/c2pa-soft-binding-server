import express, { Request, Response } from 'express';
import { requireAuth } from '../auth';
import { findByBinding } from '../store';
import { extractSoftBinding } from '../softBinding';
import { validateReferenceUrl } from '../utils/ssrf';
import { MAX_UPLOAD_SIZE, MAX_REFERENCE_SIZE } from '../config';

const router = express.Router();

const ASSET_MIME_RE = /^(image|audio|video|application|model|text)\//;

// Body parser for raw binary assets (byContent route)
const rawAsset = express.raw({
  type: req => ASSET_MIME_RE.test(req.headers['content-type'] ?? ''),
  limit: MAX_UPLOAD_SIZE,
});

// GET /matches/byBinding
router.get('/matches/byBinding', requireAuth(), async (req: Request, res: Response) => {
  const { value, alg } = req.query as Record<string, string | undefined>;
  const maxResults = parseInt((req.query.maxResults as string) ?? '10', 10);

  if (!value || !alg) {
    return res.status(400).json({ error: 'Missing required query parameters: value, alg' });
  }
  if (isNaN(maxResults) || maxResults < 1) {
    return res.status(400).json({ error: 'maxResults must be a positive integer' });
  }

  try {
    return res.json({ matches: await findByBinding(value, maxResults) });
  } catch {
    return res.status(500).json({ error: 'Service failure' });
  }
});

// POST /matches/byBinding  (for large binding values that don't fit in a URL)
router.post('/matches/byBinding', requireAuth(), async (req: Request, res: Response) => {
  const { value, alg } = (req.body ?? {}) as Record<string, string | undefined>;
  const maxResults = parseInt((req.query.maxResults as string) ?? '10', 10);

  if (!value || !alg) {
    return res.status(400).json({ error: 'Request body must include value and alg' });
  }
  if (isNaN(maxResults) || maxResults < 1) {
    return res.status(400).json({ error: 'maxResults must be a positive integer' });
  }

  try {
    return res.json({ matches: await findByBinding(value, maxResults) });
  } catch {
    return res.status(500).json({ error: 'Service failure' });
  }
});

// POST /matches/byContent  (raw binary asset upload)
router.post('/matches/byContent', requireAuth(), rawAsset, async (req: Request, res: Response) => {
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
      bindingValue = await extractSoftBinding(req.body as Buffer, contentType, alg);
    }
    // Fall back to caller-supplied hint if extraction returns nothing
    if (!bindingValue && hintAlg && hintValue) {
      bindingValue = hintValue;
    }

    if (!bindingValue) {
      return res.json({ matches: [] });
    }
    return res.json({ matches: await findByBinding(bindingValue, maxResults) });
  } catch {
    return res.status(500).json({ error: 'Service failure' });
  }
});

// POST /matches/byReference  (server downloads the asset — optional endpoint)
router.post(
  '/matches/byReference',
  requireAuth(),
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
    if (assetLength > MAX_REFERENCE_SIZE) {
      return res
        .status(400)
        .json({ error: `assetLength exceeds the server limit of ${MAX_REFERENCE_SIZE} bytes` });
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
      if (contentLength > MAX_REFERENCE_SIZE) {
        return res
          .status(400)
          .json({ error: `Remote asset exceeds the server limit of ${MAX_REFERENCE_SIZE} bytes` });
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
        bindingValue = await extractSoftBinding(buffer, effectiveType, alg);
      }
      if (!bindingValue && hintAlg && hintValue) {
        bindingValue = hintValue;
      }

      if (!bindingValue) {
        return res.json({ matches: [] });
      }
      return res.json({ matches: await findByBinding(bindingValue, maxResults) });
    } catch (err) {
      if (err instanceof Error) {
        const ssrfMsg = ['URL', 'HTTPS', 'IP', 'hostname'].some(k => err.message.includes(k));
        if (ssrfMsg) return res.status(400).json({ error: err.message });
      }
      return res.status(500).json({ error: 'Service failure' });
    }
  },
);

export default router;
