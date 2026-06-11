# @cognitiveproof/softbinding-api-plugin-sqlite

SQLite `DataStorePlugin` for [`@cognitiveproof/softbinding-api-server`](https://github.com/mrappard/c2pa-soft-binding-server) — the C2PA Soft Binding Resolution API server.

Persists C2PA Manifest Stores, soft binding associations, and repository receipts in a local SQLite database (via `better-sqlite3`). Good for local development, demos, and small single-instance deployments.

## Install

```bash
npm install @cognitiveproof/softbinding-api-server @cognitiveproof/softbinding-api-plugin-sqlite
```

## Usage

```ts
import { createServer } from '@cognitiveproof/softbinding-api-server';

const app = createServer({
  dataStore: '@cognitiveproof/softbinding-api-plugin-sqlite',
  // ...
});
```

Or pass the package name via the `DATASTORE_PLUGIN` environment variable and omit the `dataStore` option entirely.

## Configuration

| Env var          | Default                     | Description                                                                                                                       |
| ---------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `SQLITE_DB_PATH` | `./data/softbinding.sqlite` | Path to the database file. Use `:memory:` for an ephemeral in-memory database (data is lost on restart — useful for tests/demos). |

## Schema

The plugin creates its tables automatically on first use:

- **`manifests`** — `id`, `data` (blob), `content_type`, `receipt` (json, nullable)
- **`bindings`** — `manifest_id` (foreign key to `manifests.id`, `ON DELETE CASCADE`), `binding_value`

## License

[MIT](LICENSE)
