'use strict';

// Plugin registry for soft binding extraction.
//
// To add a watermark or fingerprint algorithm:
//   const { registerExtractor } = require('./softBinding');
//   registerExtractor('com.example.watermark.v1', async (buffer, mimeType) => {
//     // Detect watermark in buffer, return base64-encoded binding value or null
//     const id = await myWatermarkLib.detect(buffer);
//     return id ? Buffer.from(id).toString('base64') : null;
//   });
//
// Algorithm names must appear in the C2PA soft binding algorithm list:
//   https://github.com/c2pa-org/softbinding-algorithm-list

const supportedWatermarks = [];
const supportedFingerprints = [];
const extractors = new Map(); // alg -> async (buffer, mimeType) => string|null

function registerExtractor(alg, fn) {
  extractors.set(alg, fn);
  if (alg.includes('watermark') && !supportedWatermarks.includes(alg)) {
    supportedWatermarks.push(alg);
  } else if (!supportedFingerprints.includes(alg)) {
    supportedFingerprints.push(alg);
  }
}

async function extractSoftBinding(buffer, mimeType, alg) {
  const fn = extractors.get(alg);
  if (!fn) return null;
  return fn(buffer, mimeType);
}

function getSupportedAlgorithms() {
  return {
    watermarks: supportedWatermarks.map(alg => ({ alg })),
    fingerprints: supportedFingerprints.map(alg => ({ alg })),
  };
}

module.exports = { registerExtractor, extractSoftBinding, getSupportedAlgorithms };
