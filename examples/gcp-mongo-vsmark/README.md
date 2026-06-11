# Example: MongoDB + GCS + Google Auth + pino + vsmark

A minimal `@cognitiveproof/softbinding-api-server` setup combining:

- **`@cognitiveproof/softbinding-api-plugin-mongodb`** — `DataStorePlugin` for manifests, bindings, and receipts
- **`@cognitiveproof/softbinding-api-plugin-gcp-bucket`** — `ObjectStorePlugin` for binary assets (used here via `loadObjectStore()` in a custom route)
- **`@cognitiveproof/softbinding-api-plugin-google-auth`** — default `AuthPlugin`, verifying Google Identity Platform JWTs
- **`@cognitiveproof/softbinding-api-plugin-pino-logger`** — structured logging via [pino](https://getpino.io/)
- **`@cognitiveproof/softbinding-api-plugin-vsmark`** — text watermark soft binding extractor (Unicode variation selectors)

## Running

```bash
npm install        # from the repo root, since this is an npm workspace
cp examples/gcp-mongo-vsmark/.env.example examples/gcp-mongo-vsmark/.env
# edit .env with your MongoDB URI, GCS bucket names, and GCP project ID
npm run dev -w softbinding-example-gcp-mongo-vsmark
```

## What it demonstrates

- Selecting a `DataStorePlugin` and `LoggerPlugin` by package name in `createServer()`
- Registering an `Extractor` (`vsmarkExtractor`) so `POST /v1/matches/byContent?alg=com.cognitiveproof.vsmark.v1` can recover a soft binding hidden in text content
- Using `loadObjectStore()` to load an `ObjectStorePlugin` outside the bundled routes — `GET /v1/assets/:key/url` returns a public GCS URL for a stored asset
- The default Google Identity Platform auth (`gcpProjectId`), which all `/v1` routes (including the custom one above) require a valid JWT for
