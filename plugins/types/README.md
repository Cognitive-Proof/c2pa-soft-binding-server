# @cognitiveproof/softbinding-api-plugin-types

Shared TypeScript interfaces for [`@cognitiveproof/softbinding-api-server`](https://github.com/mrappard/c2pa-soft-binding-server) plugins — the C2PA Soft Binding Resolution API server.

This package has no runtime behavior of its own. It exists so that storage, auth, logging, rate-limit, and extractor plugins can share a common set of types without depending on the full server package.

## Install

```bash
npm install @cognitiveproof/softbinding-api-plugin-types
```

## What's in here

| Type                                              | Used for                                                              |
| ------------------------------------------------- | --------------------------------------------------------------------- |
| `DataStorePlugin`                                 | Persists manifests, soft binding associations, and receipts           |
| `ObjectStorePlugin`                               | Stores arbitrary binary blobs (data + public buckets)                 |
| `AuthPlugin<TConfig>`                             | Builds Express middleware that authenticates `/v1` requests           |
| `Logger` / `LoggerPlugin<TConfig>`                | Structured logging interface and factory                              |
| `RateLimitStorePlugin<TConfig>`                   | Builds an `express-rate-limit` `Store` for shared rate limit counters |
| `Extractor`                                       | Recovers a soft binding value (watermark/fingerprint) from an asset   |
| `Receipt`, `Match`, `ManifestEntry`, `LoadedData` | Shared data shapes used by the interfaces above                       |

## Writing your own plugin

Implement the relevant interface and export it as the package's default export (or, for `Extractor`, pass the function directly to `createServer({ extractors })`):

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

Then point the server at it via `createServer({ dataStore: '@your-org/your-plugin' })` (or the equivalent `auth`/`logger`/`rateLimitStore`/`extractors` option).

See the [main project README](https://github.com/mrappard/c2pa-soft-binding-server#storage-auth-logging-and-rate-limit-plugins) for the full plugin architecture.

## License

[MIT](LICENSE)
