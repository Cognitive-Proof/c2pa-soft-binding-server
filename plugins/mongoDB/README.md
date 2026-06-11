# @cognitiveproof/softbinding-api-plugin-mongodb

MongoDB `DataStorePlugin` for [`@cognitiveproof/softbinding-api-server`](https://github.com/mrappard/c2pa-soft-binding-server) — the C2PA Soft Binding Resolution API server.

Persists C2PA Manifest Stores, soft binding associations, and repository receipts in MongoDB.

## Install

```bash
npm install @cognitiveproof/softbinding-api-server @cognitiveproof/softbinding-api-plugin-mongodb
```

## Usage

```ts
import { createServer } from '@cognitiveproof/softbinding-api-server';

const app = createServer({
  dataStore: '@cognitiveproof/softbinding-api-plugin-mongodb',
  // ...
});
```

Or pass the package name via the `DATASTORE_PLUGIN` environment variable and omit the `dataStore` option entirely.

## Configuration

| Env var        | Required | Description                                                      |
| -------------- | -------- | ---------------------------------------------------------------- |
| `MONGO_DB_URI` | Yes      | MongoDB connection string, e.g. `mongodb://localhost:27017/c2pa` |

## Collections

The plugin uses two collections, created automatically on first use:

- **`manifests`** — `{ id, data, contentType, receipt }`
- **`bindings`** — `{ id (binding value), manifestIds[] }`, with a one-to-many relationship to manifests via `manifestIds`

## License

[MIT](LICENSE)
