'use strict';

// Simple bearer-token auth.
// In production replace this with a real OAuth2 introspection endpoint
// or a JWT verifier using your authorization server's public key.

const { AUTH_TOKENS } = require('./config');

function requireAuth() {
  return (req, res, next) => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authorization required' });
    }
    if (!AUTH_TOKENS.has(header.slice(7))) {
      return res.status(403).json({ error: 'Client not allowed to perform this operation' });
    }
    next();
  };
}

module.exports = { requireAuth };
