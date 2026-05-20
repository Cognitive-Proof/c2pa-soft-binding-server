'use strict';

const express = require('express');
const axios = require('axios');
const { requireAuth } = require('../auth');
const { findByBinding } = require('../store');
const { extractSoftBinding } = require('../softBinding');
const { validateReferenceUrl } = require('../utils/ssrf');
const { MAX_UPLOAD_SIZE, MAX_REFERENCE_SIZE } = require('../config');

const router = express.Router();

const ASSET_MIME_RE = /^(image|audio|video|application|model|text)\//;

// Body parser for raw binary assets (byContent route)
const rawAsset = express.raw({
  type: req => ASSET_MIME_RE.test(req.headers['content-type'] || ''),
  limit: MAX_UPLOAD_SIZE,
});

// GET /matches/byBinding
router.get('/matches/byBinding', requireAuth(), (req, res) => {
  const { value, alg } = req.query;
  const maxResults = parseInt(req.query.maxResults || '10', 10);

  if (!value || !alg) {
    return res.status(400).json({ error: 'Missing required query parameters: value, alg' });
  }
  if (isNaN(maxResults) || maxResults < 1) {
    return res.status(400).json({ error: 'maxResults must be a positive integer' });
  }

  try {
    return res.json({ matches: findByBinding(value, maxResults) });
  } catch {
    return res.status(500).json({ error: 'Service failure' });
  }
});

// POST /matches/byBinding  (for large binding values that don't fit in a URL)
router.post('/matches/byBinding', requireAuth(), (req, res) => {
  const { value, alg } = req.body || {};
  const maxResults = parseInt(req.query.maxResults || '10', 10);

  if (!value || !alg) {
    return res.status(400).json({ error: 'Request body must include value and alg' });
  }
  if (isNaN(maxResults) || maxResults < 1) {
    return res.status(400).json({ error: 'maxResults must be a positive integer' });
  }

  try {
    return res.json({ matches: findByBinding(value, maxResults) });
  } catch {
    return res.status(500).json({ error: 'Service failure' });
  }
});

// POST /matches/byContent  (raw binary asset upload)
router.post('/matches/byContent', requireAuth(), rawAsset, async (req, res) => {
  const contentType = req.headers['content-type'] || '';
  const { alg, hintAlg, hintValue } = req.query;
  const maxResults = parseInt(req.query.maxResults || '10', 10);

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
    let bindingValue = null;

    if (alg) {
      bindingValue = await extractSoftBinding(req.body, contentType, alg);
    }
    // Fall back to caller-supplied hint if extraction returns nothing
    if (!bindingValue && hintAlg && hintValue) {
      bindingValue = hintValue;
    }

    if (!bindingValue) {
      return res.json({ matches: [] });
    }
    return res.json({ matches: findByBinding(bindingValue, maxResults) });
  } catch {
    return res.status(500).json({ error: 'Service failure' });
  }
});

// POST /matches/byReference  (server downloads the asset — optional endpoint)
router.post('/matches/byReference', requireAuth(), async (req, res) => {
  const { referenceUrl, assetLength, assetType, region } = req.body || {};
  const { alg, hintAlg, hintValue } = req.query;
  const maxResults = parseInt(req.query.maxResults || '10', 10);

  if (!referenceUrl || assetLength == null) {
    return res.status(400).json({ error: 'referenceUrl and assetLength are required' });
  }
  if (isNaN(maxResults) || maxResults < 1) {
    return res.status(400).json({ error: 'maxResults must be a positive integer' });
  }
  if (assetLength > MAX_REFERENCE_SIZE) {
    return res.status(400).json({ error: `assetLength exceeds the server limit of ${MAX_REFERENCE_SIZE} bytes` });
  }

  try {
    await validateReferenceUrl(referenceUrl);

    const response = await axios.get(referenceUrl, {
      responseType: 'arraybuffer',
      maxContentLength: MAX_REFERENCE_SIZE,
      timeout: 30_000,
      headers: assetType ? { Accept: assetType } : {},
    });

    // Verify the downloaded content type matches what the caller declared
    const downloadedType = (response.headers['content-type'] || '').split(';')[0].trim();
    if (assetType && !downloadedType.startsWith(assetType.split('/')[0])) {
      return res.status(400).json({ error: 'Downloaded asset MIME type does not match assetType' });
    }

    const buffer = Buffer.from(response.data);
    const effectiveType = assetType || downloadedType || 'application/octet-stream';

    let bindingValue = null;
    if (alg) {
      bindingValue = await extractSoftBinding(buffer, effectiveType, alg);
    }
    if (!bindingValue && hintAlg && hintValue) {
      bindingValue = hintValue;
    }

    if (!bindingValue) {
      return res.json({ matches: [] });
    }
    return res.json({ matches: findByBinding(bindingValue, maxResults) });
  } catch (err) {
    const ssrfMsg = ['URL', 'HTTPS', 'IP', 'hostname'].some(k => err.message.includes(k));
    if (ssrfMsg) return res.status(400).json({ error: err.message });
    return res.status(500).json({ error: 'Service failure' });
  }
});

module.exports = router;
