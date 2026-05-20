'use strict';

// In-memory store — swap out for PostgreSQL, Redis, etc. in production.
// manifests: Map<manifestId, { data: Buffer, contentType: string, receipt: object|null }>
// bindings:  Map<bindingValue, Set<manifestId>>

const { v4: uuidv4 } = require('uuid');

const manifests = new Map();
const bindings = new Map();

function generateManifestId() {
  return `urn:c2pa:${uuidv4()}`;
}

function addManifest(data, contentType) {
  const manifestId = generateManifestId();
  manifests.set(manifestId, { data, contentType, receipt: null });
  return manifestId;
}

function getManifest(manifestId) {
  return manifests.get(manifestId) || null;
}

function manifestExists(manifestId) {
  return manifests.has(manifestId);
}

function deleteManifest(manifestId) {
  if (!manifests.has(manifestId)) return false;
  manifests.delete(manifestId);
  for (const [bv, ids] of bindings.entries()) {
    ids.delete(manifestId);
    if (ids.size === 0) bindings.delete(bv);
  }
  return true;
}

function createBinding(bindingValue, manifestId) {
  if (!manifests.has(manifestId)) return false;
  if (!bindings.has(bindingValue)) bindings.set(bindingValue, new Set());
  bindings.get(bindingValue).add(manifestId);
  return true;
}

// PUT semantics: replace all existing associations for this binding value
function updateBinding(bindingValue, manifestId) {
  if (!bindings.has(bindingValue)) return false;
  if (!manifests.has(manifestId)) return false;
  bindings.set(bindingValue, new Set([manifestId]));
  return true;
}

function findByBinding(bindingValue, maxResults = 10) {
  const ids = bindings.get(bindingValue);
  if (!ids || ids.size === 0) return [];
  return Array.from(ids)
    .slice(0, maxResults)
    .map(manifestId => ({ manifestId, similarityScore: 100 }));
}

function setReceipt(manifestId, receipt) {
  const entry = manifests.get(manifestId);
  if (!entry) return false;
  entry.receipt = receipt;
  return true;
}

function getReceipt(manifestId) {
  const entry = manifests.get(manifestId);
  return entry ? entry.receipt : null;
}

module.exports = {
  addManifest, getManifest, manifestExists, deleteManifest,
  createBinding, updateBinding, findByBinding,
  setReceipt, getReceipt,
};
