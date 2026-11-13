import { createRemoteJWKSet, decodeJwt, jwtVerify, errors as joseErrors } from 'jose';
import type { RequestHandler } from 'express';
import type { AuthPlugin } from '@cognitiveproof/softbinding-api-plugin-types';

const GOOGLE_OAUTH_JWKS_URI = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const AUTH_SCOPES_LOCALS_KEY = 'c2paAuthScopes';

export interface ServiceAccountAuthOptions {
  /**
   * Expected `aud` claim: the audience the caller requested its ID token for,
   * normally this server's public URL. Required — without it, a token minted
   * for any other service would be accepted.
   */
  audience: string;
  /**
   * Service-account email → the scopes it is granted. This allowlist is what
   * grants access: any Google service account can mint an ID token for any
   * audience, so unlisted accounts are rejected with 403.
   */
  accounts: Record<string, string[]>;
  /**
   * Middleware to delegate to when the bearer token was not issued by
   * `accounts.google.com` (e.g. `createGoogleAuthMiddleware(projectId)` for
   * Identity Platform users). If omitted, such tokens are rejected with 401.
   */
  fallback?: RequestHandler;
  /** JWKS endpoint for verifying token signatures. Default: Google's OAuth2 certs. */
  jwksUri?: string;
}

function isGoogleIssued(token: string): boolean {
  try {
    const { iss } = decodeJwt(token);
    return typeof iss === 'string' && GOOGLE_ISSUERS.includes(iss);
  } catch {
    return false;
  }
}

/**
 * Express middleware that verifies `Authorization: Bearer <token>` headers as
 * Google-signed service-account ID tokens (e.g. fetched from the Cloud Run
 * metadata server), and maps the token's verified `email` to scopes via an
 * allowlist. ID tokens carry no `scope` claim, so the allowlist supplies them.
 * Keys are fetched once per middleware instance and cached/refreshed by jose.
 */
const createServiceAccountAuthMiddleware: AuthPlugin<ServiceAccountAuthOptions> = (options) => {
  const { audience, accounts, fallback, jwksUri = GOOGLE_OAUTH_JWKS_URI } = options;
  if (!audience) {
    throw new Error('google-service-account-auth: `audience` is required');
  }

  const JWKS = createRemoteJWKSet(new URL(jwksUri));

  return async (req, res, next) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      if (fallback) return fallback(req, res, next);
      res.status(401).json({ error: 'Authorization required' });
      return;
    }

    const token = header.slice(7);
    if (fallback && !isGoogleIssued(token)) {
      return fallback(req, res, next);
    }

    let payload;
    try {
      ({ payload } = await jwtVerify(token, JWKS, { issuer: GOOGLE_ISSUERS, audience }));
    } catch (err) {
      if (err instanceof joseErrors.JWTExpired) {
        res.status(401).json({ error: 'Token expired' });
      } else {
        res.status(401).json({ error: 'Invalid token' });
      }
      return;
    }

    const email = typeof payload.email === 'string' ? payload.email : undefined;
    const scopes =
      email &&
      payload.email_verified === true &&
      Object.prototype.hasOwnProperty.call(accounts, email)
        ? accounts[email]
        : undefined;
    if (!scopes) {
      res.status(403).json({ error: 'Caller is not an allowed service account' });
      return;
    }

    res.locals[AUTH_SCOPES_LOCALS_KEY] = [...scopes];
    next();
  };
};

/**
 * Reads `ServiceAccountAuthOptions` from the environment:
 * - `SA_AUTH_AUDIENCE` — the expected audience (this server's public URL).
 * - `SA_AUTH_ACCOUNTS` — JSON object of service-account email → scopes, e.g.
 *   `{"signer@PROJECT.iam.gserviceaccount.com":["store:manifests","store:bindings"]}`.
 *
 * Returns `undefined` when `SA_AUTH_ACCOUNTS` is unset, so callers can make
 * service-account auth opt-in. Throws if either value is present but invalid.
 */
export function serviceAccountAuthOptionsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): Pick<ServiceAccountAuthOptions, 'audience' | 'accounts'> | undefined {
  const rawAccounts = env.SA_AUTH_ACCOUNTS;
  if (!rawAccounts) return undefined;

  const audience = env.SA_AUTH_AUDIENCE;
  if (!audience) {
    throw new Error('SA_AUTH_AUDIENCE must be set when SA_AUTH_ACCOUNTS is set');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawAccounts);
  } catch {
    throw new Error('SA_AUTH_ACCOUNTS is not valid JSON');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('SA_AUTH_ACCOUNTS must be a JSON object of email → scopes');
  }
  for (const [email, scopes] of Object.entries(parsed)) {
    if (!Array.isArray(scopes) || !scopes.every((scope) => typeof scope === 'string')) {
      throw new Error(`SA_AUTH_ACCOUNTS["${email}"] must be an array of scope strings`);
    }
  }

  return { audience, accounts: parsed as Record<string, string[]> };
}

export default createServiceAccountAuthMiddleware;
