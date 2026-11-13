import express, { NextFunction, Request, RequestHandler, Response, Router } from 'express';
import type { ObjectStorePlugin } from '@cognitiveproof/softbinding-api-plugin-types';
import { requireAuthScope } from '../auth';

export interface OriginalsRouterDeps {
  originalsStore: ObjectStorePlugin;
  auth: RequestHandler;
  maxOriginalSize: number;
}

const MANIFEST_ID_RE = /^urn:c2pa:[0-9a-f-]{36}$/i;
const ORIGINAL_MIME_TYPES = ['text/plain', 'text/markdown'];

// The text stored under a manifest id never changes after signing, so GET
// responses can be cached indefinitely.
const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

function originalKey(manifestId: string): string {
  return `originals/${encodeURIComponent(manifestId)}`;
}

/**
 * Normalizes a request Content-Type to the stored form
 * (`text/plain; charset=utf-8` or `text/markdown; charset=utf-8`), or returns
 * undefined if it's any other media type or a non-UTF-8 charset.
 */
function normalizeOriginalContentType(header: string | undefined): string | undefined {
  if (!header) return undefined;

  const [mime, ...params] = header.split(';').map((part) => part.trim().toLowerCase());
  if (!ORIGINAL_MIME_TYPES.includes(mime)) return undefined;

  for (const param of params) {
    const [name, value] = param.split('=').map((part) => part.trim().replace(/^"|"$/g, ''));
    if (name === 'charset' && value !== 'utf-8' && value !== 'utf8') return undefined;
  }

  return `${mime}; charset=utf-8`;
}

/** Only ever serve back text/plain or text/markdown, whatever was stored. */
function servedContentType(stored: string | undefined): string {
  return normalizeOriginalContentType(stored) ?? 'text/plain; charset=utf-8';
}

function validateManifestId(req: Request, res: Response, next: NextFunction): void {
  if (!MANIFEST_ID_RE.test(req.params.manifestId)) {
    res.status(400).json({ error: 'manifestId must be of the form urn:c2pa:<uuid>' });
    return;
  }
  next();
}

export function createOriginalsRouter(deps: OriginalsRouterDeps): Router {
  const { originalsStore, auth, maxOriginalSize } = deps;
  const router = express.Router();
  const requireOriginalsScope = requireAuthScope('store:originals');

  // Read the body as raw bytes (not express.text) so the stored original is
  // byte-for-byte what the caller signed — no BOM stripping or re-encoding.
  const rawBody = express.raw({ type: () => true, limit: maxOriginalSize });
  const parseBody: RequestHandler = (req, res, next) => {
    rawBody(req, res, (err?: { type?: string }) => {
      if (err?.type === 'entity.too.large') {
        res
          .status(413)
          .json({ error: `Original exceeds the maximum size of ${maxOriginalSize} bytes` });
        return;
      }
      if (err) {
        res.status(400).json({ error: 'Failed to read request body' });
        return;
      }
      next();
    });
  };

  // PUT /originals/:manifestId  — store (or idempotently overwrite) the
  // signed text. Doesn't require the manifest to exist yet: callers upload
  // the original before the manifest that references it.
  router.put(
    '/originals/:manifestId',
    auth,
    requireOriginalsScope,
    validateManifestId,
    (req: Request, res: Response, next: NextFunction) => {
      if (!normalizeOriginalContentType(req.headers['content-type'])) {
        res.status(415).json({
          error: 'Content-Type must be text/plain or text/markdown (UTF-8)',
        });
        return;
      }
      next();
    },
    parseBody,
    async (req: Request, res: Response) => {
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        return res.status(400).json({ error: 'Request body must be non-empty text' });
      }

      try {
        await originalsStore.saveData(
          originalKey(req.params.manifestId),
          req.body,
          normalizeOriginalContentType(req.headers['content-type']),
        );
        return res.status(204).send();
      } catch {
        return res.status(500).json({ error: 'Service failure' });
      }
    },
  );

  // GET /originals/:manifestId  — no auth required: verifiers follow the
  // manifest's asset reference here without credentials.
  router.get('/originals/:manifestId', validateManifestId, async (req: Request, res: Response) => {
    try {
      const original = await originalsStore.loadData(originalKey(req.params.manifestId));
      if (!original) {
        return res.status(404).json({ error: 'Original not found' });
      }

      res.set({
        'Content-Type': servedContentType(original.contentType),
        'Content-Disposition': 'inline',
        'Cache-Control': IMMUTABLE_CACHE_CONTROL,
      });
      return res.status(200).send(original.buffer);
    } catch {
      return res.status(500).json({ error: 'Service failure' });
    }
  });

  // DELETE /originals/:manifestId
  router.delete(
    '/originals/:manifestId',
    auth,
    requireOriginalsScope,
    validateManifestId,
    async (req: Request, res: Response) => {
      try {
        const deleted = await originalsStore.deleteData(originalKey(req.params.manifestId));
        if (!deleted) {
          return res.status(404).json({ error: 'Original not found' });
        }
        return res.status(204).send();
      } catch {
        return res.status(500).json({ error: 'Service failure' });
      }
    },
  );

  return router;
}
