import { createRemoteJWKSet, jwtVerify, errors as joseErrors } from 'jose';
import type { Request, RequestHandler, Response } from 'express';
import type { Logger } from '@cognitiveproof/softbinding-api-plugin-types';

export const AUTH_SCOPES_LOCALS_KEY = 'c2paAuthScopes';
export const AUTH_CONTEXT_LOCALS_KEY = 'c2paAuthContext';

export type AuthScope =
  'fetch:manifests' | 'store:manifests' | 'store:bindings' | 'store:originals';

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

// A no-op middleware for requests that aren't authenticated: it leaves
// AUTH_SCOPES_LOCALS_KEY/AUTH_CONTEXT_LOCALS_KEY unset, so requireAuthScope()
// treats every request as authorized (see its "custom middleware remains
// responsible for its own authorization" branch) and no AuthContext is ever
// exposed to isAuthRequired checks.
const allowAllMiddleware: RequestHandler = (_req, _res, next) => next();

/**
 * Resolves the auth middleware for createServer():
 * - `auth` as a function is used as-is (bring your own middleware).
 * - `auth` as a `JwtAuthOptions` object builds a generic JWT-verification
 *   middleware for that issuer/audience/JWKS.
 * - Otherwise, no authentication is performed: every request to `/v1`
 *   routes is treated as fully authorized, and a warning is logged so this
 *   doesn't go unnoticed in production. To require real auth, either pass
 *   `auth` directly, or install and wire in an `AuthPlugin` package
 *   yourself, e.g.
 *   `auth: require('@cognitiveproof/softbinding-api-plugin-google-auth').default(gcpProjectId)`.
 */
export function resolveAuthMiddleware(
  auth: RequestHandler | JwtAuthOptions | undefined,
  logger: Logger,
): RequestHandler {
  if (typeof auth === 'function') return auth;
  if (auth) return createJwtAuthMiddleware(auth);

  logger.warn(
    '`auth` is not configured — every request to /v1 routes will be treated as fully ' +
      'authorized, with no identity verification. This is not safe for production. Pass ' +
      '`auth` (custom middleware, or `{ issuer, audience, jwksUri }` for an OIDC provider), ' +
      "or wire in an AuthPlugin package yourself, e.g. `auth: require('@cognitiveproof/" +
      "softbinding-api-plugin-google-auth').default(gcpProjectId)`. See the README section " +
      '"Authentication" for details.',
  );

  return allowAllMiddleware;
}

// A no-op middleware for cases where optional (non-failing) auth can't be
// derived: it leaves AUTH_CONTEXT_LOCALS_KEY unset, i.e. always anonymous.
const anonymousMiddleware: RequestHandler = (_req, _res, next) => next();

/**
 * Resolves a non-failing companion to resolveAuthMiddleware(): it exposes an
 * AuthContext (scopes + claims) on res.locals[AUTH_CONTEXT_LOCALS_KEY] when
 * the caller presents a valid bearer token, but never rejects the request
 * when one is missing or invalid. Intended for per-resource authorization
 * decisions (e.g. `isAuthRequired` checks) that need to know who's asking
 * without making auth mandatory for every request.
 *
 * - `auth` as a custom middleware function can't be safely re-invoked in a
 *   non-failing mode, so no context is ever populated in that case.
 * - `auth` as `JwtAuthOptions` builds an optional JWT-verification
 *   middleware for that issuer/audience/JWKS.
 * - Otherwise (no `auth` configured, same as resolveAuthMiddleware's
 *   allow-all fallback) always anonymous — there's no token to verify.
 */
export function resolveOptionalAuthMiddleware(
  auth: RequestHandler | JwtAuthOptions | undefined,
): RequestHandler {
  if (typeof auth === 'function') return anonymousMiddleware;
  if (auth) return createOptionalJwtAuthMiddleware(auth);

  return anonymousMiddleware;
}

/**
 * Decides whether a read needs the usual auth. Called with the resource
 * being read and, when available, the caller's AuthContext (see
 * resolveOptionalAuthMiddleware for when that's populated). Return `true`
 * to require a token with `fetch:manifests`, `false` to allow anyone.
 */
export type AuthRequiredCheck<T> = (
  resource: T,
  auth: AuthContext | undefined,
) => boolean | Promise<boolean>;

export interface ReadAuthGateOptions<T> {
  /** If omitted, the gate is the plain `auth` + scope chain. */
  check?: AuthRequiredCheck<T>;
  auth: RequestHandler;
  optionalAuth: RequestHandler;
  requireScope: RequestHandler;
  resource: (req: Request) => T;
  /**
   * If set, a caller that fails auth gets this 404 body instead of the auth
   * middleware's own 401/403, so a private resource looks the same as a
   * missing one.
   */
  notFound?: Record<string, unknown>;
}

// Stands in for `res` while the auth chain runs, so that a rejection (any
// attempt to send a response) becomes a 404 instead. res.locals is
// inherited, so scopes the auth middleware records still land on `res`.
function rejectAsNotFound(res: Response, body: Record<string, unknown>): Response {
  const proxy = Object.create(res) as Response;
  const chain = () => proxy;
  const send404 = () => {
    if (!res.headersSent) res.status(404).json(body);
    return proxy;
  };
  Object.assign(proxy, {
    status: chain,
    set: chain,
    header: chain,
    setHeader: chain,
    type: chain,
    json: send404,
    send: send404,
    sendStatus: send404,
    end: send404,
  });
  return proxy;
}

/**
 * Builds the middleware chain for a read-only route. Without a `check`, it's
 * `auth` + the scope check, as on every other route. With one, the check
 * runs first: `false` lets the request through anonymously, `true` runs the
 * usual auth chain.
 */
export function createReadAuthGate<T>(options: ReadAuthGateOptions<T>): RequestHandler[] {
  const { check, auth, optionalAuth, requireScope, resource, notFound } = options;
  if (!check) return [auth, requireScope];

  const gate: RequestHandler = async (req, res, next) => {
    let required: boolean;
    try {
      const context = res.locals[AUTH_CONTEXT_LOCALS_KEY] as AuthContext | undefined;
      required = await check(resource(req), context);
    } catch {
      res.status(500).json({ error: 'Service failure' });
      return;
    }
    if (!required) {
      next();
      return;
    }

    const target = notFound ? rejectAsNotFound(res, notFound) : res;
    try {
      await auth(req, target, (err?: unknown) => {
        if (err) return next(err);
        requireScope(req, target, next);
      });
    } catch (err) {
      next(err);
    }
  };

  return [optionalAuth, gate];
}
