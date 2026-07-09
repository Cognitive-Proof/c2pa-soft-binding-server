import { createRemoteJWKSet, jwtVerify, errors as joseErrors } from 'jose';
import type { RequestHandler } from 'express';
import type { AuthPlugin } from '@cognitiveproof/softbinding-api-plugin-types';

export const AUTH_SCOPES_LOCALS_KEY = 'c2paAuthScopes';
export const AUTH_CONTEXT_LOCALS_KEY = 'c2paAuthContext';

export type AuthScope = 'fetch:manifests' | 'store:manifests' | 'store:bindings';

/** Scopes and raw claims of a successfully verified bearer token. */
export interface AuthContext {
  scopes: string[];
  claims: Record<string, unknown>;
}

export interface JwtAuthOptions {
  /** Expected `iss` claim. */
  issuer: string;
  /** Expected `aud` claim. */
  audience: string;
  /** URL of the identity provider's JWKS endpoint. */
  jwksUri: string;
}

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

export function requireAuthScope(requiredScope: AuthScope): RequestHandler {
  return (_req, res, next) => {
    if (!Object.prototype.hasOwnProperty.call(res.locals, AUTH_SCOPES_LOCALS_KEY)) {
      // Custom auth middleware remains responsible for its own authorization.
      next();
      return;
    }

    const scopes = res.locals[AUTH_SCOPES_LOCALS_KEY] as unknown;
    if (Array.isArray(scopes) && scopes.includes(requiredScope)) {
      next();
      return;
    }

    res.status(403).json({ error: `Missing required scope: ${requiredScope}` });
  };
}

/**
 * Express middleware that verifies `Authorization: Bearer <token>` headers as
 * a JWT issued by the given identity provider. Keys are fetched once per
 * middleware instance and cached in memory; jose refreshes them automatically
 * on rotation.
 */
export function createJwtAuthMiddleware(options: JwtAuthOptions): RequestHandler {
  const JWKS = createRemoteJWKSet(new URL(options.jwksUri));
  const { issuer, audience } = options;

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
}

/**
 * Express middleware that verifies a `Authorization: Bearer <token>` header
 * the same way `createJwtAuthMiddleware` does, but never rejects the
 * request: if the token is missing, malformed, expired, or otherwise
 * invalid, it just leaves `res.locals[AUTH_CONTEXT_LOCALS_KEY]` unset and
 * calls `next()`. Used to give route-level authorization decisions (e.g. a
 * per-resource public/private check) access to the caller's scopes/claims
 * when available, without forcing every request to be authenticated.
 */
export function createOptionalJwtAuthMiddleware(options: JwtAuthOptions): RequestHandler {
  const JWKS = createRemoteJWKSet(new URL(options.jwksUri));
  const { issuer, audience } = options;

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
}

// Loads the auth plugin used as the default when `auth` is not provided:
// either an npm package name to require() (e.g. the bundled
// @cognitiveproof/softbinding-api-plugin-google-auth), falling back to
// AUTH_PLUGIN.
function loadAuthPlugin(): AuthPlugin<string> {
  const packageName =
    process.env.AUTH_PLUGIN ?? '@cognitiveproof/softbinding-api-plugin-google-auth';

  try {
    return (require(packageName) as { default: AuthPlugin<string> }).default;
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'MODULE_NOT_FOUND') {
      throw new Error(
        `Auth plugin "${packageName}" is not installed. Run \`npm install ${packageName}\`.`,
        {
          cause: err,
        },
      );
    }
    throw err;
  }
}

/**
 * Resolves the auth middleware for createServer():
 * - `auth` as a function is used as-is (bring your own middleware).
 * - `auth` as a `JwtAuthOptions` object builds a generic JWT-verification
 *   middleware for that issuer/audience/JWKS.
 * - Otherwise loads the default auth plugin (Google Identity Platform,
 *   unless `AUTH_PLUGIN` overrides it) using `gcpProjectId` (or the
 *   `GCP_PROJECT_ID` env var), which is required unless
 *   `SKIP_ENV_VALIDATION` is set.
 */
export function resolveAuthMiddleware(
  auth: RequestHandler | JwtAuthOptions | undefined,
  gcpProjectId: string | undefined,
): RequestHandler {
  if (typeof auth === 'function') return auth;
  if (auth) return createJwtAuthMiddleware(auth);

  const projectId = gcpProjectId ?? process.env.GCP_PROJECT_ID;

  if (!projectId && !process.env.SKIP_ENV_VALIDATION) {
    throw new Error(
      'Missing required configuration: provide `auth` (custom middleware or JWT config) or ' +
        '`gcpProjectId` (or set the GCP_PROJECT_ID environment variable).',
    );
  }

  return loadAuthPlugin()(projectId ?? '');
}

// A no-op middleware for cases where optional (non-failing) auth can't be
// derived: it leaves AUTH_CONTEXT_LOCALS_KEY unset, i.e. always anonymous.
const anonymousMiddleware: RequestHandler = (_req, _res, next) => next();

// Loads the same default auth plugin package as loadAuthPlugin(), but its
// optional named export (if the plugin provides one) instead of the
// required default export. Bundled plugins (e.g. google-auth) provide this;
// third-party AuthPlugin packages are not required to.
function loadOptionalAuthPlugin(): AuthPlugin<string> | undefined {
  const packageName =
    process.env.AUTH_PLUGIN ?? '@cognitiveproof/softbinding-api-plugin-google-auth';

  try {
    return (require(packageName) as { createOptionalAuthMiddleware?: AuthPlugin<string> })
      .createOptionalAuthMiddleware;
  } catch {
    return undefined;
  }
}

/**
 * Resolves a non-failing companion to resolveAuthMiddleware(): it exposes an
 * AuthContext (scopes + claims) on res.locals[AUTH_CONTEXT_LOCALS_KEY] when
 * the caller presents a valid bearer token, but never rejects the request
 * when one is missing or invalid. Intended for per-resource authorization
 * decisions (e.g. `isManifestAuthRequired`) that need to know who's asking
 * without making auth mandatory for every request.
 *
 * - `auth` as a custom middleware function can't be safely re-invoked in a
 *   non-failing mode, so no context is ever populated in that case.
 * - `auth` as `JwtAuthOptions` builds an optional JWT-verification
 *   middleware for that issuer/audience/JWKS.
 * - Otherwise uses the default auth plugin's optional export, if it
 *   provides one; falls back to always-anonymous if not.
 */
export function resolveOptionalAuthMiddleware(
  auth: RequestHandler | JwtAuthOptions | undefined,
  gcpProjectId: string | undefined,
): RequestHandler {
  if (typeof auth === 'function') return anonymousMiddleware;
  if (auth) return createOptionalJwtAuthMiddleware(auth);

  const projectId = gcpProjectId ?? process.env.GCP_PROJECT_ID;
  const plugin = loadOptionalAuthPlugin();
  return plugin ? plugin(projectId ?? '') : anonymousMiddleware;
}
