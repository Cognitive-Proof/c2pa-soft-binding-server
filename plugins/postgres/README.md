# @cognitiveproof/softbinding-api-plugin-postgres

PostgreSQL `DataStorePlugin` for [`@cognitiveproof/softbinding-api-server`](https://github.com/mrappard/c2pa-soft-binding-server) — the C2PA Soft Binding Resolution API server.

Persists C2PA Manifest Stores, soft binding associations, and repository receipts in PostgreSQL.

## Install

```bash
npm install @cognitiveproof/softbinding-api-server @cognitiveproof/softbinding-api-plugin-postgres
```

## Usage

```ts
import { createServer } from '@cognitiveproof/softbinding-api-server';

const app = createServer({
  dataStore: '@cognitiveproof/softbinding-api-plugin-postgres',
  // ...
});
```

Or pass the package name via the `DATASTORE_PLUGIN` environment variable and omit the `dataStore` option entirely.

## Configuration

| Env var        | Required | Description                                                                |
| -------------- | -------- | -------------------------------------------------------------------------- |
| `POSTGRES_URL` | Yes      | PostgreSQL connection string, e.g. `postgres://user:pass@host:5432/dbname` |

## Schema

The plugin creates its tables automatically on first use:

- **`manifests`** — `id`, `data` (bytea), `content_type`, `receipt` (json, nullable)
- **`bindings`** — `manifest_id` (foreign key to `manifests.id`, `ON DELETE CASCADE`), `binding_value`

## License

[MIT](LICENSE)
