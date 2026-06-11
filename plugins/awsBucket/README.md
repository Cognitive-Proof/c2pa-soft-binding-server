# @cognitiveproof/softbinding-api-plugin-aws-bucket

AWS S3 `ObjectStorePlugin` for [`@cognitiveproof/softbinding-api-server`](https://github.com/mrappard/c2pa-soft-binding-server) — the C2PA Soft Binding Resolution API server.

Stores arbitrary binary blobs (e.g. assets referenced by `byReference`) in two S3 buckets — a private "data" bucket and a "public" bucket served via signed/public URLs. Also works with S3-compatible services (MinIO, Cloudflare R2, DigitalOcean Spaces, etc.).

## Install

```bash
npm install @cognitiveproof/softbinding-api-server @cognitiveproof/softbinding-api-plugin-aws-bucket
```

## Usage

```ts
import { createServer, loadObjectStore } from '@cognitiveproof/softbinding-api-server';

const objectStore = loadObjectStore('@cognitiveproof/softbinding-api-plugin-aws-bucket');
```

Or pass the package name via the `OBJECTSTORE_PLUGIN` environment variable.

> Note: `createServer()` does not call `loadObjectStore()` automatically — no bundled route currently needs blob storage. Use `loadObjectStore()` directly in your own routes/middleware if you need it.

## Configuration

| Env var                   | Required | Default     | Description                                                                                                          |
| ------------------------- | -------- | ----------- | -------------------------------------------------------------------------------------------------------------------- |
| `DATA_BUCKET_NAME`        | Yes      | —           | Name of the private S3 bucket used for `saveData`/`loadData`/`deleteData`                                            |
| `PUBLIC_BUCKET_NAME`      | Yes      | —           | Name of the S3 bucket used for `savePublicData`/`loadPublicData`/`getPublicUrl`                                      |
| `AWS_REGION`              | No       | `us-east-1` | AWS region                                                                                                           |
| `AWS_S3_ENDPOINT`         | No       | —           | Custom S3-compatible endpoint (e.g. MinIO, R2, DigitalOcean Spaces). If unset, the AWS SDK talks to AWS S3 directly. |
| `AWS_S3_FORCE_PATH_STYLE` | No       | `false`     | Set to `true` for S3-compatible services that require path-style requests                                            |

AWS credentials are resolved via the standard [AWS SDK credential chain](https://docs.aws.amazon.com/sdkref/latest/guide/standardized-credentials.html) (environment variables, shared config file, IAM role, etc.).

## License

[MIT](LICENSE)
