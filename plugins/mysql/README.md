# @cognitiveproof/softbinding-api-plugin-mysql

MySQL `DataStorePlugin` for [`@cognitiveproof/softbinding-api-server`](https://github.com/mrappard/c2pa-soft-binding-server) — the C2PA Soft Binding Resolution API server.

Persists C2PA Manifest Stores, soft binding associations, and repository receipts in MySQL.

## Install

```bash
npm install @cognitiveproof/softbinding-api-server @cognitiveproof/softbinding-api-plugin-mysql
```

## Usage

```ts
import { createServer } from '@cognitiveproof/softbinding-api-server';

const app = createServer({
  dataStore: '@cognitiveproof/softbinding-api-plugin-mysql',
  // ...
});
```

Or pass the package name via the `DATASTORE_PLUGIN` environment variable and omit the `dataStore` option entirely.

## Configuration

| Env var     | Required | Description                                                        |
| ----------- | -------- | ------------------------------------------------------------------ |
| `MYSQL_URL` | Yes      | MySQL connection string, e.g. `mysql://user:pass@host:3306/dbname` |

## Schema

The plugin creates its tables automatically on first use:

- **`manifests`** — `id`, `data` (blob), `content_type`, `receipt` (json, nullable)
- **`bindings`** — `manifest_id` (foreign key to `manifests.id`, `ON DELETE CASCADE`), `binding_value`

## License

[MIT](LICENSE)
