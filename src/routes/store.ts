import express, { Request, Response } from 'express';
import crypto from 'crypto';
import { requireAuth } from '../auth';
import * as db from '../store';
import { Receipt } from '../store';
import { REPO_URI, RECEIPT_SECRET } from '../config';

const router = express.Router();

// Body parser for C2PA Manifest Store blobs
const c2paBody = express.raw({ type: 'application/c2pa', limit: '100mb' });

function buildReceipt(manifestId: string): Receipt {
  const proof = crypto
    .createHmac('sha256', RECEIPT_SECRET)
    .update(manifestId)
    .digest('base64url');

  return {
    '@context': {
      c2pa: 'https://c2pa.org/ns/',
      receipt: 'https://c2pa.org/ns/manifest-receipt#',
    },
    '@type': 'org.c2pa.manifest-receipt',
    repository: {
      uri: REPO_URI,
      manifestId,
    },
    anchor: {
      uri: `${REPO_URI}/v1/manifests/${encodeURIComponent(manifestId)}/receipts`,
      proof: {
        alg: 'HMAC-SHA256',
        value: proof,
      },
    },
  };
}

// POST /manifests  — ingest a C2PA Manifest Store
router.post('/manifests', requireAuth(), c2paBody, async (req: Request, res: Response) => {
  const returnReceipt = req.query.returnReceipt === 'true';

  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    return res
      .status(400)
      .json({ error: 'Request body must be a non-empty application/c2pa blob' });
  }

  try {
    const manifestId = await db.addManifest(req.body as Buffer, 'application/c2pa');
    const result: { manifestId: string; receipt?: Receipt } = { manifestId };

    if (returnReceipt) {
      const receipt = buildReceipt(manifestId);
      await db.setReceipt(manifestId, receipt);
      result.receipt = receipt;
    }

    return res.status(200).json(result);
  } catch {
    return res.status(500).json({ error: 'Service failure' });
  }
});

// POST /bindings  — associate a soft binding value with a stored manifest
router.post('/bindings', requireAuth(), async (req: Request, res: Response) => {
  const { bindingValue, manifestId } = (req.body ?? {}) as Record<string, string | undefined>;

  if (!bindingValue || !manifestId) {
    return res.status(400).json({ error: 'bindingValue and manifestId are required' });
  }

  try {
    const created = await db.createBinding(bindingValue, manifestId);
    if (!created) {
      return res.status(404).json({ error: 'Soft binding id or C2PA Manifest id not found' });
    }
    return res.status(204).send();
  } catch {
    return res.status(500).json({ error: 'Service failure' });
  }
});

// PUT /bindings  — replace an existing soft binding's manifest pointer
router.put('/bindings', requireAuth(), async (req: Request, res: Response) => {
  const { bindingValue, manifestId } = (req.body ?? {}) as Record<string, string | undefined>;

  if (!bindingValue || !manifestId) {
    return res.status(400).json({ error: 'bindingValue and manifestId are required' });
  }

  try {
    const ok = await db.updateBinding(bindingValue, manifestId);
    if (!ok) {
      return res.status(404).json({ error: 'Soft binding value not found' });
    }
    return res.status(204).send();
  } catch {
    return res.status(500).json({ error: 'Service failure' });
  }
});

// DELETE /manifests/:manifestId  — remove a manifest and its bindings
router.delete('/manifests/:manifestId', requireAuth(), async (req: Request, res: Response) => {
  try {
    const ok = await db.deleteManifest(req.params.manifestId);
    if (!ok) {
      return res.status(404).json({ error: 'C2PA Manifest Store not found' });
    }
    return res.status(204).send();
  } catch {
    return res.status(500).json({ error: 'Service failure' });
  }
});

export default router;
