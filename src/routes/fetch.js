'use strict';

const express = require('express');
const crypto = require('crypto');
const { requireAuth } = require('../auth');
const db = require('../store');
const { RECEIPT_SECRET } = require('../config');

const router = express.Router();

function verifyProof(manifestId, proof) {
  if (!proof) return false;
  const expected = crypto
    .createHmac('sha256', RECEIPT_SECRET)
    .update(manifestId)
    .digest('base64url');
  // Constant-time comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(Buffer.from(proof), Buffer.from(expected));
  } catch {
    return false;
  }
}

// GET /manifests/:manifestId
// Returns the full C2PA Manifest Store (or only the active manifest if requested).
router.get('/manifests/:manifestId', requireAuth(), (req, res) => {
  const entry = db.getManifest(req.params.manifestId);
  if (!entry) {
    return res.status(404).json({ error: 'C2PA Manifest not found' });
  }

  // In a real implementation with returnActiveManifest=true you would parse
  // the CBOR-encoded C2PA Manifest Store and return only the active manifest.
  // Here we return the full blob regardless, as parsing requires a C2PA library.
  res.set('Content-Type', 'application/c2pa');
  return res.send(entry.data);
});

// GET /manifests/:manifestId/receipts  — fetch the stored receipt + verification status
router.get('/manifests/:manifestId/receipts', requireAuth(), (req, res) => {
  const { manifestId } = req.params;

  if (!db.manifestExists(manifestId)) {
    return res.status(404).json({ error: 'C2PA Manifest Store or receipt not found' });
  }

  const receipt = db.getReceipt(manifestId);
  if (!receipt) {
    return res.status(404).json({ error: 'C2PA Manifest Store or receipt not found' });
  }

  const verified = verifyProof(manifestId, receipt.anchor?.proof?.value);
  return res.json({ ...receipt, verified });
});

// POST /manifests/:manifestId/receipts  — verify a caller-supplied receipt
router.post('/manifests/:manifestId/receipts', requireAuth(), (req, res) => {
  const { manifestId } = req.params;
  const receipt = req.body;

  if (!receipt || receipt['@type'] !== 'org.c2pa.manifest-receipt') {
    return res.status(400).json({ error: 'Invalid receipt: missing or wrong @type' });
  }
  if (!db.manifestExists(manifestId)) {
    return res.status(404).json({ error: 'C2PA Manifest not found' });
  }
  if (receipt.repository?.manifestId !== manifestId) {
    return res.status(400).json({
      ...receipt,
      verified: false,
      error: 'The supplied receipt manifestId does not match the requested manifestId',
    });
  }

  const verified = verifyProof(manifestId, receipt.anchor?.proof?.value);
  return res.json({
    ...receipt,
    verified,
    ...(verified ? {} : { error: 'Receipt proof verification failed' }),
  });
});

module.exports = router;
