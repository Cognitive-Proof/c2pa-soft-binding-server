import crypto from 'crypto';
import type { RequestHandler } from 'express';
import type { HelmetOptions } from 'helmet';
import type { Options as RateLimitOptions, Store as RateLimitStore } from 'express-rate-limit';
import type {
  DataStorePlugin,
  ObjectStorePlugin,
  Logger,
} from '@cognitiveproof/softbinding-api-plugin-types';
import type { Extractor } from './softBinding';
import type { AuthContext, JwtAuthOptions } from './auth';

export interface SoftBindingServerOptions {
  /** Public base URI of this server, embedded in receipts. Default: REPO_URI env var, then http://localhost:3000 */
  repoUri?: string;
  /** Secret used to sign/verify receipts (HMAC-SHA256). Default: RECEIPT_SECRET env var, else a random secret (won't survive restart). */
  receiptSecret?: string;
  /** Max size (bytes) of a directly-uploaded asset. Default: MAX_UPLOAD_SIZE env var, else 50MB. */
  maxUploadSize?: number;
  /** Max size (bytes) of JSON request bodies. Default: MAX_JSON_SIZE env var, else 10MB. */
  maxJsonSize?: number;
  /** Max size (bytes) of an asset downloaded via byReference. Default: MAX_REFERENCE_SIZE env var, else 100MB. */
  maxReferenceSize?: number;
  /**
   * Max length (characters) of the `value` query parameter on
   * `GET /matches/byBinding`. Requests exceeding it get a `414` response
   * suggesting the caller use `POST /matches/byBinding` instead, per the
   * spec. Default: MAX_QUERY_VALUE_LENGTH env var, else 2048.
   */
  maxQueryValueLength?: number;
  /** A DataStorePlugin instance, or the name of an npm package implementing one. Default: DATASTORE_PLUGIN env var, else the bundled MongoDB plugin. */
  dataStore?: DataStorePlugin | string;
  /** An ObjectStorePlugin instance, or the name of an npm package implementing one. Default: OBJECTSTORE_PLUGIN env var, else the bundled GCS plugin. */
  objectStore?: ObjectStorePlugin | string;
  /** GCP project used to verify Identity Platform JWTs with the default auth. Default: GCP_PROJECT_ID env var. */
  gcpProjectId?: string;
  /**
   * Custom authentication for `/v1` routes. Either an Express middleware
   * (bring your own auth scheme), or `{ issuer, audience, jwksUri }` to
   * verify JWTs from any OIDC-compatible identity provider. If omitted,
   * falls back to Google Identity Platform using `gcpProjectId`.
   */
  auth?: RequestHandler | JwtAuthOptions;
  /**
   * Per-manifest authorization check for `GET /manifests/:manifestId`,
   * letting you mark specific manifests public. Called with the requested
   * manifestId and, if the caller presented a valid bearer token, their
   * scopes/claims (`undefined` for an anonymous or invalid-token request).
   * Return `true` to require the usual `fetch:manifests` scope, `false` to
   * allow anyone to fetch that manifest. If omitted, all manifests require
   * auth (unchanged default behavior). A request that fails this check gets
   * the same 404 as a manifest that doesn't exist, so private manifests
   * don't reveal their existence to unauthorized callers.
   *
   * Only populated with an `AuthContext` when `auth` is `JwtAuthOptions` or
   * omitted (default Google Identity Platform auth) — custom `auth`
   * middleware functions can't be safely re-invoked in a non-failing mode,
   * so this is always called with `undefined` in that case.
   */
  isManifestAuthRequired?: (
    manifestId: string,
    auth: AuthContext | undefined,
  ) => boolean | Promise<boolean>;
  /**
   * Redirects browser requests for `GET /manifests/:manifestId` to an
   * HTML page instead of returning the raw `application/c2pa` bytes.
   * Called with the requested manifestId to build the target URL; the
   * response is a `303 See Other` to whatever it returns. Only applies
   * when the request's `Accept` header includes `text/html` (i.e. a
   * browser navigation, not an API client). Checked before auth or the
   * manifest lookup — it fires purely off the manifestId and Accept
   * header, regardless of whether the manifest exists or the caller is
   * authorized to see it. If omitted, browser requests are treated the
   * same as any other client and receive the raw manifest bytes (or the
   * usual 401/403/404).
   */
  manifestHtmlRedirect?: (manifestId: string) => string;
  /**
   * Extracts the real manifest identifier embedded in an uploaded C2PA
   * Manifest Store, for `POST /manifests` to use instead of generating a
   * random id. Takes the raw uploaded bytes and returns the active
   * manifest's own id (or throws/rejects if the bytes aren't a valid
   * Manifest Store — the request is rejected with 400). If the returned id
   * already has a manifest stored under it, the request succeeds
   * idempotently (200, no new row) when the bytes match exactly, or is
   * rejected with 400 as a label conflict when they don't. If omitted, the
   * configured data store plugin generates its own id as before. Ignored by
   * any custom DataStorePlugin whose addManifest doesn't accept an explicit
   * manifestId argument.
   */
  parseManifestId?: (data: Buffer) => string | Promise<string>;
  /** Soft binding watermark/fingerprint extractors, keyed by algorithm name. */
  extractors?: Record<string, Extractor>;
  /** Mount /docs and /v1/openapi.json. Default: true. */
  docs?: boolean;
  /**
   * A Logger instance, or the name of an npm package implementing a
   * LoggerPlugin (e.g. `@cognitiveproof/softbinding-api-plugin-pino-logger`).
   * Default: LOGGER_PLUGIN env var, else a built-in console JSON logger.
   */
  logger?: Logger | string;
  /**
   * Security headers via `helmet`. Pass `false` to disable, or a `HelmetOptions`
   * object to customize (e.g. Content-Security-Policy directives). Default: enabled
   * with helmet's defaults.
   */
  helmet?: HelmetOptions | false;
  /**
   * Rate limiting (via `express-rate-limit`) applied to all `/v1` routes. Pass
   * `false` to disable, or a `Partial<RateLimitOptions>` to customize (e.g.
   * `windowMs`/`limit`). Default: 100 requests per 15 minutes per IP.
   */
  rateLimit?: Partial<RateLimitOptions> | false;
  /**
   * A `Store` instance (e.g. from `rate-limit-redis`), or the name of an npm
   * package implementing a `RateLimitStorePlugin` (e.g.
   * `@cognitiveproof/softbinding-api-plugin-redis-rate-limit`), used to share
   * rate limit counters across server instances. Default: RATELIMIT_STORE_PLUGIN
   * env var, else express-rate-limit's default in-memory store.
   */
  rateLimitStore?: RateLimitStore | string;
  /**
   * Reports operational status for `GET /services/status`. Called on every
   * request to that endpoint; wrap real health checks (e.g. a DB ping) in
   * this function. If it throws or rejects, the response falls back to
   * `{ status: 'down' }` rather than a 500 (the endpoint itself did not
   * fail — it's honestly reporting the failure it observed). If omitted,
   * the endpoint always reports `{ status: 'ok' }`.
   */
  getServiceStatus?: () =>
    { status: 'ok' | 'degraded' | 'down' } | Promise<{ status: 'ok' | 'degraded' | 'down' }>;
}

export interface ResolvedConfig {
  repoUri: string;
  receiptSecret: string;
  maxUploadSize: number;
  maxJsonSize: number;
  maxReferenceSize: number;
  maxQueryValueLength: number;
  docs: boolean;
  helmet: HelmetOptions | false;
  rateLimit: Partial<RateLimitOptions> | false;
}

export function resolveConfig(options: SoftBindingServerOptions = {}): ResolvedConfig {
  return {
    repoUri: options.repoUri ?? process.env.REPO_URI ?? 'http://localhost:3000',
    receiptSecret:
      options.receiptSecret ?? process.env.RECEIPT_SECRET ?? crypto.randomBytes(32).toString('hex'),
    maxUploadSize: options.maxUploadSize ?? parseInt(process.env.MAX_UPLOAD_SIZE ?? '52428800', 10),
    maxJsonSize: options.maxJsonSize ?? parseInt(process.env.MAX_JSON_SIZE ?? '10485760', 10),
    maxReferenceSize:
      options.maxReferenceSize ?? parseInt(process.env.MAX_REFERENCE_SIZE ?? '104857600', 10),
    maxQueryValueLength:
      options.maxQueryValueLength ?? parseInt(process.env.MAX_QUERY_VALUE_LENGTH ?? '2048', 10),
    docs: options.docs ?? true,
    helmet: options.helmet ?? {},
    rateLimit:
      options.rateLimit === false
        ? false
        : {
            windowMs: 15 * 60 * 1000,
            limit: 100,
            standardHeaders: 'draft-7',
            legacyHeaders: false,
            ...options.rateLimit,
          },
  };
}
