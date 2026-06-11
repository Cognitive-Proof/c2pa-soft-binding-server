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
import type { JwtAuthOptions } from './auth';

export interface SoftBindingServerOptions {
  /** Public base URI of this server, embedded in receipts. Default: REPO_URI env var, then http://localhost:3000 */
  repoUri?: string;
  /** Secret used to sign/verify receipts (HMAC-SHA256). Default: RECEIPT_SECRET env var, else a random secret (won't survive restart). */
  receiptSecret?: string;
  /** Max size (bytes) of a directly-uploaded asset. Default: MAX_UPLOAD_SIZE env var, else 50MB. */
  maxUploadSize?: number;
  /** Max size (bytes) of an asset downloaded via byReference. Default: MAX_REFERENCE_SIZE env var, else 100MB. */
  maxReferenceSize?: number;
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
}

export interface ResolvedConfig {
  repoUri: string;
  receiptSecret: string;
  maxUploadSize: number;
  maxReferenceSize: number;
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
    maxReferenceSize:
      options.maxReferenceSize ?? parseInt(process.env.MAX_REFERENCE_SIZE ?? '104857600', 10),
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
