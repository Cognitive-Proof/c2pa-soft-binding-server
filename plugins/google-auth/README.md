# @cognitiveproof/softbinding-api-plugin-google-auth

Google Cloud Identity Platform `AuthPlugin` for [`@cognitiveproof/softbinding-api-server`](https://github.com/mrappard/c2pa-soft-binding-server) — the C2PA Soft Binding Resolution API server.

This is the **default auth plugin** used when `createServer()` is given no `auth` option — it's bundled with the server and doesn't need to be installed separately unless you're using it outside of `createServer()`'s default resolution.

Verifies `Authorization: Bearer <token>` headers as Google Cloud Identity Platform JWTs:

- **issuer**: `https://securetoken.google.com/<gcpProjectId>`
- **audience**: `<gcpProjectId>`

JWKS keys are fetched once per middleware instance and cached/refreshed automatically via [`jose`](https://github.com/panva/jose).

## Install

```bash
npm install @cognitiveproof/softbinding-api-server @cognitiveproof/softbinding-api-plugin-google-auth
```

## Usage

```ts
import { createServer } from '@cognitiveproof/softbinding-api-server';

const app = createServer({
  gcpProjectId: 'my-gcp-project',
  // auth resolves to this plugin by default; only needed explicitly if
  // overridden elsewhere via AUTH_PLUGIN
});
```

Or set the `GCP_PROJECT_ID` environment variable and omit `gcpProjectId`.

## Configuration

| Option / env var                     | Required                                                                 | Description                                                        |
| ------------------------------------ | ------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `gcpProjectId` (or `GCP_PROJECT_ID`) | Yes (unless `SKIP_ENV_VALIDATION` is set or a custom `auth` is provided) | The GCP project ID used as both the JWT issuer suffix and audience |

## License

[MIT](LICENSE)
