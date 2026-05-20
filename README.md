# C2PA Soft Binding Resolution API Server

A Node.js/Express implementation of the [C2PA Soft Binding Resolution API v2.3.0](https://c2pa.org/specifications). This server allows clients to store C2PA Manifest Stores, associate them with soft binding values (watermarks or fingerprints), and later recover those manifests when the metadata has been stripped from an asset.

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

| Scenario | Without soft binding | With soft binding |
|---|---|---|
| Social platform strips metadata | Provenance lost | Manifest recovered via watermark |
| Malicious manifest substitution | Cannot detect | Compare embedded vs. recovered manifest |
| Legacy pipeline strips metadata | Gap in provenance chain | Watermark bridges the gap |
| AI-generated content | GenAI label lost | Label recovered from repository |

---

## API Overview

The server implements all four route groups defined in the specification, mounted under `/v1`.

### Query — find manifests from a soft binding

| Method | Route | Description |
|---|---|---|
| `GET` | `/v1/matches/byBinding` | Look up manifests by a pre-computed binding value in the query string |
| `POST` | `/v1/matches/byBinding` | Same, but accepts a large binding value in a JSON body |
| `POST` | `/v1/matches/byContent` | Upload a raw asset; the server extracts the soft binding and searches |
| `POST` | `/v1/matches/byReference` | Provide an HTTPS URL; the server downloads the asset and searches |

### Store — ingest manifests and manage bindings

| Method | Route | Description |
|---|---|---|
| `POST` | `/v1/manifests` | Ingest a C2PA Manifest Store; returns the manifest ID and optionally a receipt |
| `POST` | `/v1/bindings` | Associate a soft binding value with a stored manifest |
| `PUT` | `/v1/bindings` | Update the manifest an existing binding points to |
| `DELETE` | `/v1/manifests/:manifestId` | Remove a manifest and its associated bindings |

### Fetch — retrieve manifests and receipts

| Method | Route | Description |
|---|---|---|
| `GET` | `/v1/manifests/:manifestId` | Retrieve a stored C2PA Manifest Store by ID |
| `GET` | `/v1/manifests/:manifestId/receipts` | Retrieve the repository receipt for a manifest |
| `POST` | `/v1/manifests/:manifestId/receipts` | Verify a caller-supplied receipt against a stored manifest |

### Service — capability discovery

| Method | Route | Description |
|---|---|---|
| `GET` | `/v1/services/supportedAlgorithms` | List the watermark and fingerprint algorithms this instance supports |

---

## Software Design

### Directory structure

```
c2pa-soft-binding-server/
├── server.js               # Entry point — composes middleware and starts the server
├── package.json
├── .env.example
└── src/
    ├── config.js           # Centralised env-based configuration
    ├── store.js            # Data layer — in-memory manifest and binding store
    ├── auth.js             # Authentication middleware
    ├── softBinding.js      # Soft binding extractor plugin registry
    ├── utils/
    │   └── ssrf.js         # SSRF protection for the byReference endpoint
    └── routes/
        ├── query.js        # GET|POST /matches/* routes
        ├── store.js        # POST|PUT /bindings, POST|DELETE /manifests routes
        ├── fetch.js        # GET /manifests/:id and receipt routes
        └── service.js      # GET /services/supportedAlgorithms
```

### Layer responsibilities

#### `server.js` — composition root

Loads `.env`, applies the global JSON body parser, mounts the four route modules, and registers a 404 and error handler. This is also where you register soft binding extractor plugins before the server starts listening.

#### `src/config.js` — configuration

A single module that reads all environment variables and exports them as named constants. Every other module imports from here rather than reading `process.env` directly, making configuration testable and the expected values visible in one place. If `RECEIPT_SECRET` is absent a random secret is generated at startup (receipts will not survive a restart — set a real secret in production).

#### `src/store.js` — data layer

Holds two in-memory `Map` structures:

- `manifests` — keyed by manifest ID, stores the raw C2PA blob and its receipt
- `bindings` — keyed by binding value, stores the set of associated manifest IDs

One binding value can map to multiple manifest IDs (e.g., multiple crop/resolution variants of the same asset), which is why the value is a `Set`. The `findByBinding` function returns results in insertion order, capped by `maxResults`.

**To use a real database** replace the exported functions in this file — the route modules only call the named exports and have no direct knowledge of how data is persisted.

#### `src/auth.js` — authentication middleware

Validates `Authorization: Bearer <token>` headers against the set of tokens configured in `AUTH_TOKENS`. Returns 401 if no header is present and 403 if the token is invalid.

This is a development-friendly stand-in. In production, replace the token check with JWT verification against your OAuth2 provider's public key, or call the provider's token introspection endpoint. The spec mandates OAuth2 client credentials flow with the scope `fetch:manifests` for query/fetch routes and `store:manifests`/`store:bindings` for write routes.

#### `src/softBinding.js` — extractor plugin registry

Watermark detection and content fingerprinting are algorithm-specific and typically provided by specialised third-party libraries. This module provides a registry so you can plug in as many algorithms as needed without changing any routing code.

```
registerExtractor(algName, async (buffer, mimeType) => base64StringOrNull)
```

When `POST /matches/byContent` or `POST /matches/byReference` is called with an `alg` query parameter, the corresponding extractor is invoked on the asset buffer. If no extractor is registered for that algorithm the route returns an empty match list. The `getSupportedAlgorithms()` function reflects whatever algorithms have been registered and drives the `/services/supportedAlgorithms` response.

#### `src/utils/ssrf.js` — SSRF protection

The `byReference` endpoint asks the server to fetch an asset from a caller-supplied URL, which is a Server-Side Request Forgery attack surface. Before downloading, this module:

1. Rejects any non-HTTPS URL
2. Resolves the hostname via DNS and rejects addresses in private/reserved ranges (RFC 1918, loopback, link-local, IPv6 ULA/link-local)

A production deployment should additionally use signed, short-lived URLs (as recommended by the spec) and enforce network-level egress controls to defeat DNS rebinding attacks.

#### `src/routes/` — HTTP handlers

Each route file is a plain Express `Router`. Route files own input validation, call into `store.js` or `softBinding.js`, and format responses. They contain no business logic beyond what is needed to translate between HTTP and the data layer.

Body parsing is applied per-route rather than globally:

- JSON routes use the global `express.json()` applied in `server.js`
- `POST /manifests` adds `express.raw({ type: 'application/c2pa' })`
- `POST /matches/byContent` adds `express.raw()` with a content-type guard that accepts any `image/*`, `audio/*`, `video/*`, `application/*`, `model/*`, or `text/*` MIME type

### Receipt mechanism

When a manifest is ingested with `?returnReceipt=true`, the server generates a receipt containing an HMAC-SHA256 proof over the manifest ID, signed with `RECEIPT_SECRET`. This proof can later be verified at `GET /manifests/:id/receipts` or by submitting the receipt to `POST /manifests/:id/receipts`.

The receipt structure follows the `org.c2pa.manifest-receipt` JSON-LD schema defined in the specification. In a production system the `anchor.proof` field would typically contain a cryptographic proof from an external transparency log or blockchain anchor rather than a local HMAC.

---

## Getting Started

### Prerequisites

- Node.js 18 or later
- npm

### Installation

```bash
git clone <repo>
cd c2pa-soft-binding-server
npm install
cp .env.example .env
# Edit .env — at minimum set AUTH_TOKENS and RECEIPT_SECRET
```

### Running

```bash
npm start        # production
npm run dev      # development with auto-reload (requires nodemon)
```

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP port to listen on |
| `AUTH_TOKENS` | `dev-token` | Comma-separated list of valid bearer tokens |
| `REPO_URI` | `http://localhost:3000` | Public base URI of this repository (used in receipts) |
| `RECEIPT_SECRET` | random | Secret for signing receipts — must be set for receipts to survive restart |
| `MAX_UPLOAD_SIZE` | `52428800` | Max direct upload size in bytes (50 MB) |
| `MAX_REFERENCE_SIZE` | `104857600` | Max download size for byReference in bytes (100 MB) |

---

## Plugging In a Watermark or Fingerprint Algorithm

Register extractors in `server.js` before `app.listen` is called. The extractor receives the asset as a `Buffer` and its MIME type, and must return a base64-encoded soft binding value or `null` if no binding is detected.

```js
const { registerExtractor } = require('./src/softBinding');

registerExtractor('com.example.watermark.v1', async (buffer, mimeType) => {
  const id = await myWatermarkLib.detect(buffer);
  return id ? Buffer.from(id).toString('base64') : null;
});
```

Algorithm names must match entries in the [C2PA Soft Binding Algorithm List](https://github.com/c2pa-org/softbinding-algorithm-list). Once registered the algorithm appears in `GET /services/supportedAlgorithms` and can be used with the `alg` parameter on the `byContent` and `byReference` routes.

---

## Production Considerations

| Concern | Current approach | Production recommendation |
|---|---|---|
| **Persistence** | In-memory Maps | Replace `src/store.js` with PostgreSQL, Redis, or similar |
| **Authentication** | Static bearer tokens | OAuth2 client credentials with JWT verification |
| **Receipts** | HMAC-SHA256 | Anchor to a transparency log or blockchain |
| **SSRF** | DNS-based IP blocking | Add signed URL enforcement and network egress controls |
| **Rate limiting** | None | Add per-client rate limiting (e.g., `express-rate-limit`) |
| **TLS** | None (plain HTTP) | Terminate TLS at a reverse proxy (nginx, Caddy, etc.) |
| **`byContent` extraction** | Plugin stubs | Integrate real watermark/fingerprint vendor SDKs |

---

## License

[Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/) — matching the C2PA Soft Binding Resolution API specification.
