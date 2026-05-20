import { createRemoteJWKSet, jwtVerify, errors as joseErrors } from 'jose';
import type { RequestHandler } from 'express';
import { env } from './env';

// Google Cloud Identity Platform JWKS endpoint — keys are fetched once and
// cached in memory; jose refreshes them automatically on rotation.
const JWKS = createRemoteJWKSet(
  new URL(
    'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com',
  ),
);

const ISSUER = `https://securetoken.google.com/${env.GCP_PROJECT_ID}`;
const AUDIENCE = env.GCP_PROJECT_ID;

export function requireAuth(): RequestHandler {
  return async (req, res, next) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Authorization required' });
      return;
    }

    try {
      await jwtVerify(header.slice(7), JWKS, { issuer: ISSUER, audience: AUDIENCE });
      next();
    } catch (err) {
      if (err instanceof joseErrors.JWTExpired) {
        res.status(401).json({ error: 'Token expired' });
      } else {
        res.status(401).json({ error: 'Invalid token' });
      }
    }
  };
}
