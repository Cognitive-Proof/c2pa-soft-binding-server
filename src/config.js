'use strict';

const crypto = require('crypto');

module.exports = {
  PORT: parseInt(process.env.PORT || '3000', 10),
  AUTH_TOKENS: new Set(
    (process.env.AUTH_TOKENS || 'dev-token')
      .split(',')
      .map(t => t.trim())
      .filter(Boolean)
  ),
  REPO_URI: process.env.REPO_URI || 'http://localhost:3000',
  // Generate a random secret if none is configured (ephemeral — receipts won't survive restart)
  RECEIPT_SECRET: process.env.RECEIPT_SECRET || crypto.randomBytes(32).toString('hex'),
  MAX_UPLOAD_SIZE: parseInt(process.env.MAX_UPLOAD_SIZE || '52428800', 10),
  MAX_REFERENCE_SIZE: parseInt(process.env.MAX_REFERENCE_SIZE || '104857600', 10),
};
