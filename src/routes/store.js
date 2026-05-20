'use strict';

const express = require('express');
const crypto = require('crypto');
const { requireAuth } = require('../auth');
const db = require('../store');
const { REPO_URI, RECEIPT_SECRET } = require('../config');

const router = express.Router();

// Body parser for C2PA Manifest Store blobs
const c2paBody = express.raw({ type: 'application/c2pa', limit: '100mb' });

function buildReceipt(manifestId) {
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
router.post('/manifests', requireAuth(), c2paBody, (req, res) => {
  const returnReceipt = req.query.returnReceipt === 'true';

  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    return res.status(400).json({ error: 'Request body must be a non-empty application/c2pa blob' });
  }

  try {
    const manifestId = db.addManifest(req.body, 'application/c2pa');
    const result = { manifestId };

    if (returnReceipt) {
      const receipt = buildReceipt(manifestId);
      db.setReceipt(manifestId, receipt);
      result.receipt = receipt;
    }

    return res.status(200).json(result);
  } catch {
    return res.status(500).json({ error: 'Service failure' });
  }
});

// POST /bindings  — associate a soft binding value with a stored manifest
router.post('/bindings', requireAuth(), (req, res) => {
  const { bindingValue, manifestId } = req.body || {};

  if (!bindingValue || !manifestId) {
    return res.status(400).json({ error: 'bindingValue and manifestId are required' });
  }
  if (!db.manifestExists(manifestId)) {
    return res.status(404).json({ error: 'Soft binding id or C2PA Manifest id not found' });
  }

  try {
    db.createBinding(bindingValue, manifestId);
    return res.status(204).send();
  } catch {
    return res.status(500).json({ error: 'Service failure' });
  }
});

// PUT /bindings  — replace an existing soft binding's manifest pointer
router.put('/bindings', requireAuth(), (req, res) => {
  const { bindingValue, manifestId } = req.body || {};

  if (!bindingValue || !manifestId) {
    return res.status(400).json({ error: 'bindingValue and manifestId are required' });
  }

  const ok = db.updateBinding(bindingValue, manifestId);
  if (!ok) {
    return res.status(404).json({ error: 'Soft binding value not found' });
  }

  return res.status(204).send();
});

// DELETE /manifests/:manifestId  — remove a manifest and its bindings
router.delete('/manifests/:manifestId', requireAuth(), (req, res) => {
  const ok = db.deleteManifest(req.params.manifestId);
  if (!ok) {
    return res.status(404).json({ error: 'C2PA Manifest Store not found' });
  }
  return res.status(204).send();
});

module.exports = router;
