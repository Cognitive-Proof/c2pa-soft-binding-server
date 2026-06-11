# @cognitiveproof/softbinding-api-plugin-gcp-bucket

Google Cloud Storage `ObjectStorePlugin` for [`@cognitiveproof/softbinding-api-server`](https://github.com/mrappard/c2pa-soft-binding-server) — the C2PA Soft Binding Resolution API server.

Stores arbitrary binary blobs (e.g. assets referenced by `byReference`) in two GCS buckets — a private "data" bucket and a "public" bucket served via signed/public URLs.

## Install

```bash
npm install @cognitiveproof/softbinding-api-server @cognitiveproof/softbinding-api-plugin-gcp-bucket
```

## Usage

```ts
import { createServer, loadObjectStore } from '@cognitiveproof/softbinding-api-server';

const objectStore = loadObjectStore('@cognitiveproof/softbinding-api-plugin-gcp-bucket');
```

Or pass the package name via the `OBJECTSTORE_PLUGIN` environment variable.

> Note: `createServer()` does not call `loadObjectStore()` automatically — no bundled route currently needs blob storage. Use `loadObjectStore()` directly in your own routes/middleware if you need it.

## Configuration

| Env var                    | Required | Description                                                                                                                                                                          |
| -------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DATA_BUCKET_NAME`         | Yes      | Name of the private GCS bucket used for `saveData`/`loadData`/`deleteData`                                                                                                           |
| `PUBLIC_BUCKET_NAME`       | Yes      | Name of the GCS bucket used for `savePublicData`/`loadPublicData`/`getPublicUrl`                                                                                                     |
| `GOOGLE_BUCKET_CREDENTIAL` | No       | JSON service account credentials (as a JSON string). If unset, uses [Application Default Credentials](https://cloud.google.com/docs/authentication/application-default-credentials). |

## License

[MIT](LICENSE)
