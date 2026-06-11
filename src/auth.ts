import { createRemoteJWKSet, jwtVerify, errors as joseErrors } from 'jose';
import type { RequestHandler } from 'express';
import type { AuthPlugin } from '@cognitiveproof/softbinding-api-plugin-types';

export interface JwtAuthOptions {
  /** Expected `iss` claim. */
  issuer: string;
  /** Expected `aud` claim. */
  audience: string;
  /** URL of the identity provider's JWKS endpoint. */
  jwksUri: string;
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
