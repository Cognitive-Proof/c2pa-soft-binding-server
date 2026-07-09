import { createRemoteJWKSet, jwtVerify, errors as joseErrors } from 'jose';
import type { AuthPlugin } from '@cognitiveproof/softbinding-api-plugin-types';

const GOOGLE_JWKS_URI =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const AUTH_SCOPES_LOCALS_KEY = 'c2paAuthScopes';
const AUTH_CONTEXT_LOCALS_KEY = 'c2paAuthContext';

function extractScopes(payload: Record<string, unknown>): string[] {
  const scopes = new Set<string>();

  for (const claim of [payload.scope, payload.scp]) {
    if (typeof claim === 'string') {
      for (const scope of claim.split(/\s+/)) {
        if (scope) scopes.add(scope);
      }
    } else if (Array.isArray(claim)) {
      for (const scope of claim) {
        if (typeof scope === 'string' && scope) scopes.add(scope);
      }
    }
  }

  return [...scopes];
}

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
      const { payload } = await jwtVerify(header.slice(7), JWKS, { issuer, audience });
      res.locals[AUTH_SCOPES_LOCALS_KEY] = extractScopes(payload);
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

/**
 * Non-failing companion to createGoogleAuthMiddleware: verifies the bearer
 * token the same way, but if it's missing/invalid/expired it just leaves
 * `res.locals[AUTH_CONTEXT_LOCALS_KEY]` unset and calls `next()` rather than
 * rejecting the request. Lets per-resource authorization checks (e.g. a
 * public/private manifest predicate) see the caller's scopes when a valid
 * token is present, without making auth mandatory for the route.
 */
export const createOptionalAuthMiddleware: AuthPlugin<string> = (gcpProjectId) => {
  const JWKS = createRemoteJWKSet(new URL(GOOGLE_JWKS_URI));
  const issuer = `https://securetoken.google.com/${gcpProjectId}`;
  const audience = gcpProjectId;

  return async (req, res, next) => {
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      try {
        const { payload } = await jwtVerify(header.slice(7), JWKS, { issuer, audience });
        res.locals[AUTH_CONTEXT_LOCALS_KEY] = { scopes: extractScopes(payload), claims: payload };
      } catch {
        // No valid token — treated the same as an anonymous request.
      }
    }

    next();
  };
};

export default createGoogleAuthMiddleware;
