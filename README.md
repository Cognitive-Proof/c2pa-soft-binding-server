# C2PA Soft Binding Resolution API Server

A Node.js/Express implementation of the [C2PA Soft Binding Resolution API v2.4](https://spec.c2pa.org/specifications/specifications/2.4/softbinding/Decoupled.html). This server allows clients to store C2PA Manifest Stores, associate them with soft binding values (watermarks or fingerprints), and later recover those manifests when the metadata has been stripped from an asset.

---

## What is Soft Binding?

C2PA (Coalition for Content Provenance and Authenticity) embeds provenance metadata — called a **Manifest Store** — directly inside media files. However, many distribution platforms strip this metadata during upload or processing.

**Soft binding** is a resilience mechanism: an invisible watermark or content fingerprint is embedded in the asset's pixels/audio/video signal itself. Because the signal is part of the content, it survives platform processing that would remove metadata. The watermark or fingerprint acts as a lookup key that can be used to retrieve the original Manifest Store from a repository — restoring the provenance chain even after the embedded metadata is gone.

### Typical recovery flow

```
Consumer detects a watermark in an image
          │
          ▼
  POST /matches/byBinding   ← sends the watermark value
          │
          ▼
  Server returns manifest ID(s)
          │
          ▼
  GET /manifests/{manifestId}   ← fetches the full Manifest Store
          │
          ▼
  Consumer validates provenance and makes a trust decision
```

### Why does this matter?

| Scenario                        | Without soft binding    | With soft binding                       |
| ------------------------------- | ----------------------- | --------------------------------------- |
| Social platform strips metadata | Provenance lost         | Manifest recovered via watermark        |
| Malicious manifest substitution | Cannot detect           | Compare embedded vs. recovered manifest |
| Legacy pipeline strips metadata | Gap in provenance chain | Watermark bridges the gap               |
| AI-generated content            | GenAI label lost        | Label recovered from repository         |

---

## API Overview

The server implements all four route groups defined in the specification, mounted under `/v1`.

### Query — find manifests from a soft binding

| Method | Route                     | Description                                                           |
| ------ | ------------------------- | --------------------------------------------------------------------- |
| `GET`  | `/v1/matches/byBinding`   | Look up manifests by a pre-computed binding value in the query string |
| `POST` | `/v1/matches/byBinding`   | Same, but accepts a large binding value in a JSON body                |
| `POST` | `/v1/matches/byContent`   | Upload a raw asset; the server extracts the soft binding and searches |
| `POST` | `/v1/matches/byReference` | Provide an HTTPS URL; the server downloads the asset and searches     |

### Store — ingest manifests and manage bindings

| Method   | Route                       | Description                                                                    |
| -------- | --------------------------- | ------------------------------------------------------------------------------ |
| `POST`   | `/v1/manifests`             | Ingest a C2PA Manifest Store; returns the manifest ID and optionally a receipt |
| `POST`   | `/v1/bindings`              | Associate a soft binding value with a stored manifest                          |
| `PUT`    | `/v1/bindings`              | Update the manifest an existing binding points to                              |
| `DELETE` | `/v1/manifests/:manifestId` | Remove a manifest and its associated bindings                                  |

### Fetch — retrieve manifests and receipts

| Method | Route                                | Description                                                |
| ------ | ------------------------------------ | ---------------------------------------------------------- |
| `GET`  | `/v1/manifests/:manifestId`          | Retrieve a stored C2PA Manifest Store by ID                |
| `GET`  | `/v1/manifests/:manifestId/receipts` | Retrieve the repository receipt for a manifest             |
| `POST` | `/v1/manifests/:manifestId/receipts` | Verify a caller-supplied receipt against a stored manifest |

### Service — capability discovery

| Method | Route                              | Description                                                          |
| ------ | ---------------------------------- | -------------------------------------------------------------------- |
| `GET`  | `/v1/services/supportedAlgorithms` | List the watermark and fingerprint algorithms this instance supports |

---

## Software Design

### Directory structure

```
c2pa-soft-binding-server/
├── package.json             # npm workspaces root — published as @cognitiveproof/softbinding-api-server
├── openapi.yaml             # OpenAPI spec served at /v1/openapi.json and /docs
├── .env.example
├── src/
│   ├── index.ts              # Library entry point — exports createServer() and shared types
│   ├── cli.ts                # Standalone entry point (bin script)
│   ├── config.ts             # SoftBindingServerOptions type + resolveConfig() (options with env-var fallbacks)
│   ├── store.ts               # loadDataStore() — resolves a DataStorePlugin instance or package name
│   ├── objectStore.ts          # loadObjectStore() — resolves an ObjectStorePlugin instance or package name
│   ├── auth.ts                 # resolveAuthMiddleware() — pluggable JWT/custom auth, defaults to Google Identity Platform
│   ├── logger.ts                # resolveLogger() — pluggable structured logging, defaults to a console JSON logger
│   ├── rateLimit.ts              # resolveRateLimitStore() — pluggable rate limit store, defaults to in-memory
│   ├── softBinding.ts          # createSoftBindingRegistry(extractors) — soft binding extractor registry
│   ├── utils/
│   │   └── ssrf.ts            # SSRF protection for the byReference endpoint
│   └── routes/
│       ├── query.ts           # createQueryRouter() — GET|POST /matches/* routes
│       ├── store.ts           # createStoreRouter() — POST|PUT /bindings, POST|DELETE /manifests routes
│       ├── fetch.ts           # createFetchRouter() — GET /manifests/:id and receipt routes
│       └── service.ts         # createServiceRouter() — GET /services/supportedAlgorithms
└── plugins/                  # Storage and auth plugins — each is its own npm package
    ├── types/                 # @cognitiveproof/softbinding-api-plugin-types — shared interfaces
    ├── mongoDB/               # @cognitiveproof/softbinding-api-plugin-mongodb — DataStore plugin
    ├── postgres/              # @cognitiveproof/softbinding-api-plugin-postgres — DataStore plugin
    ├── mysql/                 # @cognitiveproof/softbinding-api-plugin-mysql — DataStore plugin
    ├── sqlite/                # @cognitiveproof/softbinding-api-plugin-sqlite — DataStore plugin
    ├── gcpBucket/             # @cognitiveproof/softbinding-api-plugin-gcp-bucket — ObjectStore plugin
    ├── awsBucket/             # @cognitiveproof/softbinding-api-plugin-aws-bucket — ObjectStore plugin
    ├── google-auth/           # @cognitiveproof/softbinding-api-plugin-google-auth — AuthPlugin (default)
    ├── pino-logger/           # @cognitiveproof/softbinding-api-plugin-pino-logger — LoggerPlugin
    ├── redis-rate-limit/      # @cognitiveproof/softbinding-api-plugin-redis-rate-limit — RateLimitStorePlugin
    └── vsmark/                # @cognitiveproof/softbinding-api-plugin-vsmark — Extractor (text watermark)
```

### Layer responsibilities

#### `src/index.ts` — library entry point / composition root

Exports `createServer(options?)`, which resolves configuration, loads the data store plugin, builds the soft binding registry and auth middleware, and wires everything into an `express.Express` app: `helmet()` security headers (unless `helmet: false`), request logging, global JSON body parser, `/docs` + `/v1/openapi.json` (unless `docs: false`), rate limiting on `/v1` (unless `rateLimit: false`), the four route routers under `/v1`, and a 404 + error handler. The returned app is not listening — embed it in another app or call `.listen()` yourself.

#### `src/cli.ts` — standalone entry point

The `bin` script. Loads `.env`, calls `createServer()` with no overrides (so everything falls back to environment variables), and calls `app.listen(PORT)`.

#### `src/config.ts` — configuration

Defines `SoftBindingServerOptions` (the `createServer()` options type) and `resolveConfig()`, which merges each option with its environment-variable fallback (e.g. `options.repoUri ?? process.env.REPO_URI ?? 'http://localhost:3000'`). If `RECEIPT_SECRET`/`receiptSecret` is absent a random secret is generated at startup (receipts will not survive a restart — set a real secret in production). Authentication config (`auth` / `gcpProjectId`) is resolved separately by `resolveAuthMiddleware()` in `src/auth.ts` — see below.

#### `src/store.ts` and `src/objectStore.ts` — pluggable data layer

`loadDataStore(plugin?)` and `loadObjectStore(plugin?)` resolve a `DataStorePlugin` / `ObjectStorePlugin`: pass an instance directly, pass an installed npm package name to `require()`, or omit it to fall back to `DATASTORE_PLUGIN`/`OBJECTSTORE_PLUGIN` and then the default MongoDB/GCS package names (see [Storage, Auth, Logging, and Rate Limit Plugins](#storage-auth-logging-and-rate-limit-plugins) below). Those plugin packages are separate installs. `createServer()` calls `loadDataStore()` and injects the result into the route factories — routes have no direct knowledge of how or where data is persisted. `loadObjectStore()` is exported for custom routes but isn't wired into `createServer()` since no bundled route uses blob storage yet.

#### `src/auth.ts` — authentication middleware

`resolveAuthMiddleware(auth, gcpProjectId)` resolves the `auth` middleware that `createServer()` applies to all `/v1` routes, based on the `auth` and `gcpProjectId` options:

- **`auth` is an Express `RequestHandler`** — used as-is. Bring your own auth scheme entirely (API keys, sessions, a different OAuth provider, etc.).
- **`auth` is `{ issuer, audience, jwksUri }`** — builds a generic JWT-verification middleware via `createJwtAuthMiddleware()` for any OIDC-compatible identity provider (Auth0, Okta, Cognito, etc.).
- **`auth` is omitted** — loads the default **AuthPlugin** (an npm package implementing `AuthPlugin<string>` from `@cognitiveproof/softbinding-api-plugin-types`, resolved via `AUTH_PLUGIN` then the separately installed `@cognitiveproof/softbinding-api-plugin-google-auth`) and calls it with `gcpProjectId` (from `options.gcpProjectId` or `GCP_PROJECT_ID`), which is required in this case unless `SKIP_ENV_VALIDATION` is set. The Google plugin verifies `Authorization: Bearer <token>` headers as Google Identity Platform JWTs (issuer `https://securetoken.google.com/<gcpProjectId>`, audience `<gcpProjectId>`).

The JWT-based middlewares fetch their JWKS once per server instance and cache/refresh keys via `jose`, returning 401 if no header is present, the token is expired, or verification fails. They read scopes from the standard space-delimited `scope` claim or the string/array `scp` claim and publish them to `res.locals.c2paAuthScopes`.

The route layer returns 403 unless JWT-authenticated requests have the scope required by the specification: `fetch:manifests` for query/fetch routes, `store:manifests` for manifest ingestion/deletion, and `store:bindings` for binding creation/update. The bundled Google plugin requires these values to be configured as custom token claims. A fully custom `auth` middleware remains responsible for its own authorization; it can opt into the same route guards by setting `res.locals.c2paAuthScopes` to a string array.

#### `src/logger.ts` — structured logging

`resolveLogger(logger)` resolves the `Logger` that `createServer()` uses for request logging and error reporting, based on the `logger` option:

- **`logger` is a `Logger` instance** — used as-is. Bring your own logger by implementing `debug`/`info`/`warn`/`error`/`child` (e.g. wrapping an existing Winston/Bunyan instance).
- **`logger` is a package name, or `LOGGER_PLUGIN` is set** — loads an npm package implementing `LoggerPlugin` (e.g. the optional `@cognitiveproof/softbinding-api-plugin-pino-logger`).
- **`logger` is omitted and `LOGGER_PLUGIN` is unset** — falls back to `createConsoleLogger()`, a built-in logger that writes JSON lines (`level`, `time`, `msg`, plus any metadata) to stdout (`debug`/`info`/`warn`) or stderr (`error`) — no extra dependencies required.

`createServer()` mounts `createRequestLogger(logger)` as the first middleware, which logs `{ method, path, status, durationMs }` for every request once the response finishes. The error handler returns 413 for bodies exceeding the configured JSON/raw upload limits, 400 for malformed JSON, and logs other uncaught route errors via `logger.error()` instead of `console.error()`.

#### Security headers (`helmet`)

`createServer()` mounts [`helmet()`](https://helmetjs.github.io/) as the first middleware, which sets a baseline of security-related HTTP response headers (`X-Content-Type-Options`, `X-DNS-Prefetch-Control`, `Strict-Transport-Security`, removes `X-Powered-By`, etc.). Pass `helmet: false` to disable it entirely, or `helmet: { ...HelmetOptions }` to customize (e.g. configure a Content-Security-Policy). Default: enabled with helmet's defaults.

#### `src/rateLimit.ts` — rate limiting

`createServer()` mounts [`express-rate-limit`](https://express-rate-limit.mintlify.app/) on all `/v1` routes (not `/`, `/docs`, or `/v1/openapi.json`), returning `429 Too Many Requests` once a client exceeds the limit. Default: 100 requests per 15 minutes per IP; pass `rateLimit: { ...RateLimitOptions }` to customize (`windowMs`, `limit`, `keyGenerator`, etc.) or `rateLimit: false` to disable.

By default the limiter uses express-rate-limit's in-memory store, which is **per-process** — each server instance/replica tracks its own counters. `resolveRateLimitStore(rateLimitStore)` resolves a shared `Store` instead, given the `rateLimitStore` option:

- **`rateLimitStore` is a `Store` instance** — used as-is (e.g. constructed with `rate-limit-redis` directly).
- **`rateLimitStore` is a package name, or `RATELIMIT_STORE_PLUGIN` is set** — loads an npm package implementing `RateLimitStorePlugin` (e.g. the optional `@cognitiveproof/softbinding-api-plugin-redis-rate-limit`).
- **`rateLimitStore` is omitted and `RATELIMIT_STORE_PLUGIN` is unset** — uses express-rate-limit's default in-memory store.

#### `src/softBinding.ts` — extractor registry

Watermark detection and content fingerprinting are algorithm-specific and typically provided by specialised third-party libraries. `createSoftBindingRegistry(extractors?)` builds a per-server registry from the `extractors` option passed to `createServer()`:

```ts
createServer({
  extractors: {
    'com.example.watermark.v1': async (buffer, mimeType) => base64StringOrNull,
  },
});
```

When `POST /matches/byContent` or `POST /matches/byReference` is called with an `alg` query parameter, the corresponding extractor is invoked on the asset buffer. If no extractor is registered for that algorithm the route returns an empty match list. `getSupportedAlgorithms()` reflects whatever algorithms were registered and drives the `/services/supportedAlgorithms` response.

#### `src/utils/ssrf.ts` — SSRF protection

The `byReference` endpoint asks the server to fetch an asset from a caller-supplied URL, which is a Server-Side Request Forgery attack surface. Before downloading, this module:

1. Rejects any non-HTTPS URL
2. Resolves the hostname via DNS and rejects addresses in private/reserved ranges (RFC 1918, loopback, link-local, IPv6 ULA/link-local)

A production deployment should additionally use signed, short-lived URLs (as recommended by the spec) and enforce network-level egress controls to defeat DNS rebinding attacks.

#### `src/routes/` — HTTP handlers

Each route file exports a `createXRouter(deps)` factory that returns a plain Express `Router`, built from the data store, auth middleware, and config values `createServer()` passes in. Route handlers own input validation, call into `dataStore`/`softBinding`, and format responses. They contain no business logic beyond what is needed to translate between HTTP and the data layer.

Body parsing is applied per-route rather than globally:

- JSON routes use the global `express.json({ limit: maxJsonSize })` applied in `createServer()`
- `POST /manifests` adds `express.raw({ type: 'application/c2pa' })`
- `POST /matches/byContent` adds `express.raw()` with a content-type guard that accepts any `image/*`, `audio/*`, `video/*`, `application/*`, `model/*`, or `text/*` MIME type

### Receipt mechanism

When a manifest is ingested with `?returnReceipt=true`, the server generates a receipt containing an HMAC-SHA256 proof over the manifest ID, signed with `RECEIPT_SECRET`. This proof can later be verified at `GET /manifests/:id/receipts` or by submitting the receipt to `POST /manifests/:id/receipts`.

The receipt structure follows the `org.c2pa.manifest-receipt` JSON-LD schema defined in the specification. In a production system the `anchor.proof` field would typically contain a cryptographic proof from an external transparency log or blockchain anchor rather than a local HMAC.

---

## Getting Started

Run this project standalone (e.g. as a cloned repo) when you want a ready-to-go server controlled entirely by environment variables. If you want to embed the API into your own Express app or configure it programmatically, see [Using as a Library](#using-as-a-library).

### Prerequisites

- Node.js 18 or later
- npm

### Installation

```bash
git clone <repo>
cd c2pa-soft-binding-server
npm install
cp .env.example .env
# Edit .env — at minimum set GCP_PROJECT_ID and RECEIPT_SECRET
```

### Running

```bash
npm start        # production — runs dist/cli.js
npm run dev      # development with auto-reload (requires nodemon)
```

### Environment variables

`src/cli.ts` calls `createServer()` with no overrides, so every option falls back to the environment variables below (see [`SoftBindingServerOptions`](src/config.ts) for the corresponding option name):

| Variable                 | Default                                              | Description                                                                                                               |
| ------------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                   | `3000`                                               | HTTP port to listen on (CLI only — not a `createServer()` option)                                                         |
| `GCP_PROJECT_ID`         | —                                                    | Google Cloud project ID; used by the default Google Identity Platform auth (`gcpProjectId`) — not needed if `auth` is set |
| `REPO_URI`               | `http://localhost:3000`                              | Public base URI of this repository, used in receipts (`repoUri`)                                                          |
| `RECEIPT_SECRET`         | random                                               | Secret for signing receipts — must be set for receipts to survive restart (`receiptSecret`)                               |
| `MAX_UPLOAD_SIZE`        | `52428800`                                           | Max direct upload size in bytes (50 MB) (`maxUploadSize`)                                                                 |
| `MAX_JSON_SIZE`          | `10485760`                                           | Max JSON request body size in bytes (10 MB) (`maxJsonSize`)                                                               |
| `MAX_REFERENCE_SIZE`     | `104857600`                                          | Max download size for byReference in bytes (100 MB) (`maxReferenceSize`)                                                  |
| `DATASTORE_PLUGIN`       | `@cognitiveproof/softbinding-api-plugin-mongodb`     | npm package implementing `DataStorePlugin` (`dataStore`)                                                                  |
| `OBJECTSTORE_PLUGIN`     | `@cognitiveproof/softbinding-api-plugin-gcp-bucket`  | npm package implementing `ObjectStorePlugin` (`objectStore`)                                                              |
| `AUTH_PLUGIN`            | `@cognitiveproof/softbinding-api-plugin-google-auth` | npm package implementing `AuthPlugin<string>`, used when `auth` is not set                                                |
| `LOGGER_PLUGIN`          | —                                                    | npm package implementing `LoggerPlugin`, used when `logger` is not set (default: built-in console JSON logger)            |
| `RATELIMIT_STORE_PLUGIN` | —                                                    | npm package implementing `RateLimitStorePlugin`, used when `rateLimitStore` is not set (default: in-memory store)         |
| `SKIP_ENV_VALIDATION`    | —                                                    | Set to skip the `gcpProjectId`/`auth` requirement (and per-plugin env validation) — useful for tests                      |

Each storage plugin reads its own additional environment variables — see [Storage, Auth, Logging, and Rate Limit Plugins](#storage-auth-logging-and-rate-limit-plugins).

---

## Using as a Library

Install the package and call `createServer(options)` to get a configured `express.Express` app — mount it inside an existing app, or call `.listen()` yourself:

```bash
npm install @cognitiveproof/softbinding-api-server \
  @cognitiveproof/softbinding-api-plugin-sqlite \
  @cognitiveproof/softbinding-api-plugin-google-auth
```

```ts
import { createServer } from '@cognitiveproof/softbinding-api-server';

const c2paApp = createServer({
  gcpProjectId: 'my-gcp-project',
  repoUri: 'https://repo.example.com',
  receiptSecret: process.env.RECEIPT_SECRET,

  // Pass a plugin instance directly instead of an npm package name:
  dataStore: require('@cognitiveproof/softbinding-api-plugin-sqlite').default,

  extractors: {
    'com.example.watermark.v1': async (buffer, mimeType) => {
      const id = await myWatermarkLib.detect(buffer);
      return id ? Buffer.from(id).toString('base64') : null;
    },
  },
});

// Standalone:
c2paApp.listen(3000);

// Or mounted inside an existing app:
// app.use('/c2pa', c2paApp);
```

`SoftBindingServerOptions` (all optional, each falls back to an environment variable — see the table above):

| Option                                               | Type                                                                                                                      |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `repoUri`                                            | `string`                                                                                                                  |
| `receiptSecret`                                      | `string`                                                                                                                  |
| `maxUploadSize` / `maxJsonSize` / `maxReferenceSize` | `number`                                                                                                                  |
| `dataStore`                                          | `DataStorePlugin \| string`                                                                                               |
| `objectStore`                                        | `ObjectStorePlugin \| string`                                                                                             |
| `gcpProjectId`                                       | `string` — used by the default Google Identity Platform auth                                                              |
| `auth`                                               | `RequestHandler \| { issuer, audience, jwksUri }` — overrides the default auth (see below)                                |
| `extractors`                                         | `Record<string, Extractor>`                                                                                               |
| `docs`                                               | `boolean` (default `true`) — mounts `/docs` and `/v1/openapi.json`                                                        |
| `logger`                                             | `Logger \| string` — overrides the default console JSON logger (see below)                                                |
| `helmet`                                             | `HelmetOptions \| false` — customizes or disables `helmet()` security headers (default: enabled with helmet's defaults)   |
| `rateLimit`                                          | `Partial<RateLimitOptions> \| false` — customizes or disables rate limiting on `/v1` (default: 100 requests/15min per IP) |
| `rateLimitStore`                                     | `Store \| string` — shared rate limit store (e.g. Redis) for multi-instance deployments                                   |

By default, `/v1` routes require a Google Identity Platform JWT for `gcpProjectId` with the route's required scope in a `scope` or `scp` custom claim. To use a different identity provider or auth scheme, pass `auth`:

```ts
// Any OIDC-compatible provider (Auth0, Okta, Cognito, ...):
createServer({
  auth: {
    issuer: 'https://my-tenant.auth0.com/',
    audience: 'https://my-api/',
    jwksUri: 'https://my-tenant.auth0.com/.well-known/jwks.json',
  },
  // ...
});

// Or a fully custom Express middleware:
createServer({
  auth: (req, res, next) => {
    if (req.headers['x-api-key'] === process.env.API_KEY) {
      res.locals.c2paAuthScopes = ['fetch:manifests', 'store:manifests', 'store:bindings'];
      return next();
    }
    res.status(401).json({ error: 'Unauthorized' });
  },
  // ...
});
```

By default, logs are written as JSON lines to stdout/stderr. To use a different logger, pass `logger`:

```ts
// A LoggerPlugin package, e.g. the optional pino plugin:
createServer({
  logger: '@cognitiveproof/softbinding-api-plugin-pino-logger',
  // ...
});

// Or a Logger instance (bring your own — wrap Winston, Bunyan, pino, etc.):
createServer({
  logger: {
    debug: (msg, meta) => myLogger.debug(meta, msg),
    info: (msg, meta) => myLogger.info(meta, msg),
    warn: (msg, meta) => myLogger.warn(meta, msg),
    error: (msg, meta) => myLogger.error(meta, msg),
    child: (bindings) => wrapLogger(myLogger.child(bindings)),
  },
  // ...
});
```

By default, `/v1` routes are limited to 100 requests/15min per IP using an in-memory store. To customize the limit or share counters across instances via Redis, pass `rateLimit`/`rateLimitStore`:

```ts
createServer({
  rateLimit: { windowMs: 60_000, limit: 30 }, // 30 requests/minute per IP
  rateLimitStore: '@cognitiveproof/softbinding-api-plugin-redis-rate-limit',
  // ...
});

// Or disable rate limiting entirely (e.g. if handled by a gateway/load balancer):
createServer({
  rateLimit: false,
  // ...
});
```

The package also re-exports the `DataStorePlugin`, `ObjectStorePlugin`, `AuthPlugin`, `Logger`, `LoggerPlugin`, `RateLimitOptions`, `RateLimitStore`, `RateLimitStorePlugin`, `Match`, `ManifestEntry`, `Receipt`, `LoadedData`, `Extractor`, `AuthScope`, and `JwtAuthOptions` types from `@cognitiveproof/softbinding-api-plugin-types`/`src/auth.ts`, plus `loadDataStore`, `loadObjectStore`, `createJwtAuthMiddleware`, `requireAuthScope`, `AUTH_SCOPES_LOCALS_KEY`, and `createConsoleLogger` helpers.

---

## Storage, Auth, Logging, and Rate Limit Plugins

Persistence, the default authentication scheme, logging, and rate limit storage are implemented entirely by npm packages that conform to the interfaces in [`@cognitiveproof/softbinding-api-plugin-types`](plugins/types/src/index.ts):

- **`DataStorePlugin`** — stores C2PA Manifest Stores, soft binding associations, and receipts (`addManifest`, `getManifest`, `findByBinding`, `createBinding`, etc.)
- **`ObjectStorePlugin`** — stores arbitrary binary blobs in a "data" bucket and a "public" bucket (`saveData`, `loadData`, `getPublicUrl`, etc.)
- **`AuthPlugin<TConfig>`** — builds the Express middleware used to authenticate `/v1` requests when `auth` isn't passed to `createServer()`, given a config value (`gcpProjectId` for the Google plugin)
- **`LoggerPlugin<TConfig>`** — builds the `Logger` used for request logging and error reporting when `logger` isn't passed to `createServer()`, given an implementation-specific config value (e.g. a log level)
- **`RateLimitStorePlugin<TConfig>`** — builds the express-rate-limit `Store` used to share rate limit counters across instances when `rateLimitStore` isn't passed to `createServer()`, given a config value (e.g. a Redis URL)

`createServer()` resolves the data store plugin via `loadDataStore()` (an instance passed as `options.dataStore`, an npm package name, or `DATASTORE_PLUGIN`/the default MongoDB package name), the auth plugin via `AUTH_PLUGIN`/the default Google auth package name, the logger via `resolveLogger()` (`options.logger`, `LOGGER_PLUGIN`, or the built-in console logger), and the rate limit store via `resolveRateLimitStore()` (`options.rateLimitStore`, `RATELIMIT_STORE_PLUGIN`, or express-rate-limit's in-memory store), injecting the results into the route factories. Plugin packages must be installed separately. Route code never imports a plugin directly.

### Bundled plugins

| Package                                                   | Implements             | Backend                                   | Required env vars                                                                                             |
| --------------------------------------------------------- | ---------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `@cognitiveproof/softbinding-api-plugin-mongodb`          | `DataStorePlugin`      | MongoDB                                   | `MONGO_DB_URI`                                                                                                |
| `@cognitiveproof/softbinding-api-plugin-postgres`         | `DataStorePlugin`      | PostgreSQL                                | `POSTGRES_URL`                                                                                                |
| `@cognitiveproof/softbinding-api-plugin-mysql`            | `DataStorePlugin`      | MySQL                                     | `MYSQL_URL`                                                                                                   |
| `@cognitiveproof/softbinding-api-plugin-sqlite`           | `DataStorePlugin`      | SQLite (file or in-memory)                | `SQLITE_DB_PATH` (default `./data/softbinding.sqlite`)                                                        |
| `@cognitiveproof/softbinding-api-plugin-gcp-bucket`       | `ObjectStorePlugin`    | Google Cloud Storage                      | `DATA_BUCKET_NAME`, `PUBLIC_BUCKET_NAME`, optional `GOOGLE_BUCKET_CREDENTIAL`                                 |
| `@cognitiveproof/softbinding-api-plugin-aws-bucket`       | `ObjectStorePlugin`    | AWS S3 (or S3-compatible, e.g. MinIO/R2)  | `DATA_BUCKET_NAME`, `PUBLIC_BUCKET_NAME`, optional `AWS_REGION`, `AWS_S3_ENDPOINT`, `AWS_S3_FORCE_PATH_STYLE` |
| `@cognitiveproof/softbinding-api-plugin-google-auth`      | `AuthPlugin<string>`   | Google Cloud Identity Platform            | `GCP_PROJECT_ID` (`gcpProjectId`)                                                                             |
| `@cognitiveproof/softbinding-api-plugin-pino-logger`      | `LoggerPlugin`         | [pino](https://getpino.io/)               | optional `LOG_LEVEL` (default `info`)                                                                         |
| `@cognitiveproof/softbinding-api-plugin-redis-rate-limit` | `RateLimitStorePlugin` | Redis (via `rate-limit-redis`/`ioredis`)  | optional `REDIS_URL` (default `redis://localhost:6379`)                                                       |
| `@cognitiveproof/softbinding-api-plugin-vsmark`           | `Extractor`            | Unicode variation-selector text watermark | none                                                                                                          |

The SQL plugins (`postgres`, `mysql`, `sqlite`) all use the same `manifests` / `bindings` schema with a foreign key from `bindings.manifest_id` to `manifests.id` (`ON DELETE CASCADE`), and create their tables automatically on first use.

These live in this repo as npm workspaces under `plugins/`, but are ordinary npm packages — they can be published and installed independently.

### Installing only the plugins you need

The bundled plugins are published as separate packages and declared as optional peer dependencies of `@cognitiveproof/softbinding-api-server`. Installing the server does **not** install every database driver and cloud SDK. Install the server together with only the plugin packages your deployment uses:

```bash
npm install @cognitiveproof/softbinding-api-server @cognitiveproof/softbinding-api-plugin-sqlite
```

The standalone CLI needs both a data store and an auth implementation. For example, the default MongoDB and Google Identity Platform configuration is installed with:

```bash
npm install @cognitiveproof/softbinding-api-server \
  @cognitiveproof/softbinding-api-plugin-mongodb \
  @cognitiveproof/softbinding-api-plugin-google-auth
```

```ts
createServer({
  dataStore: '@cognitiveproof/softbinding-api-plugin-sqlite', // or pass the imported plugin directly
});
```

If `loadDataStore`/`loadObjectStore`/the auth plugin loader/the logger plugin loader/the rate limit store plugin loader can't find the requested plugin package, `createServer()` throws an error telling you which package to `npm install`. `@cognitiveproof/softbinding-api-plugin-google-auth` is required only when relying on the default Google auth; passing `auth` makes it unnecessary. Likewise, the pino logger and Redis rate-limit plugins are required only when selected explicitly. The server has built-in console logging and in-memory rate limiting.

### Switching backends

To switch backends, install one of the provided PostgreSQL, MySQL, SQLite, MongoDB, GCS, or S3 packages and point the relevant option or environment variable at its package name:

```bash
npm install @cognitiveproof/softbinding-api-plugin-postgres
```

```env
DATASTORE_PLUGIN=@cognitiveproof/softbinding-api-plugin-postgres
```

The plugin is loaded at runtime without server code changes. Implement a custom `DataStorePlugin` or `ObjectStorePlugin` only when the provided backends do not cover the deployment.

Custom plugin packages must export a default object implementing the corresponding interface:

```ts
import type { DataStorePlugin } from '@cognitiveproof/softbinding-api-plugin-types';

const plugin: DataStorePlugin = {
  async addManifest(data, contentType) {
    /* ... */
  },
  async getManifest(manifestId) {
    /* ... */
  },
  // ...
};

export default plugin;
```

---

## Plugging In a Watermark or Fingerprint Algorithm

Pass extractors to `createServer({ extractors })` (see [Using as a Library](#using-as-a-library)). Each extractor receives the asset as a `Buffer` and its MIME type, and must return a base64-encoded soft binding value or `null` if no binding is detected.

```ts
createServer({
  extractors: {
    'com.example.watermark.v1': async (buffer, mimeType) => {
      const id = await myWatermarkLib.detect(buffer);
      return id ? Buffer.from(id).toString('base64') : null;
    },
  },
});
```

Algorithm names must match entries in the [C2PA Soft Binding Algorithm List](https://github.com/c2pa-org/softbinding-algorithm-list). Once registered the algorithm appears in `GET /services/supportedAlgorithms` and can be used with the `alg` parameter on the `byContent` and `byReference` routes.

### Bundled: text watermarking via Unicode variation selectors

`@cognitiveproof/softbinding-api-plugin-vsmark` is a ready-to-use `Extractor` for plain-text/HTML assets. It hides a soft binding value inside a piece of text by appending an invisible [Unicode variation selector](<https://en.wikipedia.org/wiki/Variation_Selectors_(Unicode_block)>) after each character, encoding the binding value byte-by-byte. The carrier text displays unchanged (the variation selectors are invisible to renderers) but a watermarked copy can be traced back to the original binding.

```bash
npm install @cognitiveproof/softbinding-api-plugin-vsmark
```

```ts
import { createServer } from '@cognitiveproof/softbinding-api-server';
import {
  vsmarkExtractor,
  VSMARK_ALGORITHM,
  encode,
} from '@cognitiveproof/softbinding-api-plugin-vsmark';

createServer({
  extractors: { [VSMARK_ALGORITHM]: vsmarkExtractor },
});

// When publishing an asset, embed the manifest's binding value into its text:
const watermarked = encode(bindingValue, articleText);
```

`vsmarkExtractor` decodes the asset buffer as UTF-8 and returns the hidden binding value, or `null` if the asset isn't text or contains no watermark. `decode(text)` is also exported directly for use outside of `createServer()`.

---

## Production Considerations

| Concern                    | Current approach                                            | Production recommendation                                                                                               |
| -------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Persistence**            | MongoDB, PostgreSQL, MySQL, and SQLite data store plugins   | Select the backend appropriate for durability, backups, scaling, and operational ownership                              |
| **Object storage**         | Google Cloud Storage and S3-compatible object store plugins | Configure bucket lifecycle, encryption, access controls, and regional availability                                      |
| **Authentication**         | Google Identity Platform or generic OIDC JWT verification   | Use OAuth2 client credentials, issue required scopes, and rotate provider credentials                                   |
| **Receipts**               | HMAC-SHA256                                                 | Set a persistent `RECEIPT_SECRET`; use an external transparency log when independently verifiable receipts are required |
| **SSRF**                   | HTTPS-only URLs, redirect validation, and IP-range blocking | Add signed URL enforcement and network-level egress controls                                                            |
| **Rate limiting**          | `express-rate-limit`, 100 requests per 15 minutes per IP    | Tune limits and use the Redis rate-limit store or an upstream gateway for multiple instances                            |
| **Request limits**         | Configurable JSON, upload, and remote-download size limits  | Set limits for expected assets and enforce matching limits at the reverse proxy                                         |
| **TLS**                    | Application serves plain HTTP                               | Terminate TLS at a trusted reverse proxy or managed load balancer                                                       |
| **`byContent` extraction** | Extractor interface and variation-selector text plugin      | Integrate supported watermark/fingerprint vendor SDKs and monitor extraction cost, latency, and failures                |

---

## License

[MIT](LICENSE)
