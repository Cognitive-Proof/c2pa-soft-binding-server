import { createRemoteJWKSet, jwtVerify, errors as joseErrors } from 'jose';
import type { AuthPlugin } from '@cognitiveproof/softbinding-api-plugin-types';

const GOOGLE_JWKS_URI =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

/**
 * Express middleware that verifies `Authorization: Bearer <token>` headers
 * as Google Cloud Identity Platform JWTs for the given GCP project (issuer
 * `https://securetoken.google.com/<gcpProjectId>`, audience `gcpProjectId`).
 * Keys are fetched once per middleware instance and cached/refreshed by jose.
 */
const createGoogleAuthMiddleware: AuthPlugin<string> = (gcpProjectId) => {
  const JWKS = createRemoteJWKSet(new URL(GOOGLE_JWKS_URI));
  const issuer = `https://securetoken.google.com/${gcpProjectId}`;
  const audience = gcpProjectId;

  return async (req, res, next) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Authorization required' });
      return;
    }

    try {
      await jwtVerify(header.slice(7), JWKS, { issuer, audience });
      next();
    } catch (err) {
      if (err instanceof joseErrors.JWTExpired) {
        res.status(401).json({ error: 'Token expired' });
      } else {
        res.status(401).json({ error: 'Invalid token' });
      }
    }
  };
};

export default createGoogleAuthMiddleware;
