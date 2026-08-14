# @cognitiveproof/softbinding-api-plugin-google-auth

Google Cloud Identity Platform `AuthPlugin` for [`@cognitiveproof/softbinding-api-server`](https://github.com/mrappard/c2pa-soft-binding-server) — the C2PA Soft Binding Resolution API server.

`createServer()` has no default auth plugin — if `auth` is omitted, every request is allowed through with a startup warning. This plugin is an opt-in you install and wire in yourself when you want real auth backed by Google Cloud Identity Platform.

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
import createGoogleAuthMiddleware from '@cognitiveproof/softbinding-api-plugin-google-auth';

const app = createServer({
  auth: createGoogleAuthMiddleware('my-gcp-project'),
});
```

## Configuration

| Argument       | Required | Description                                                        |
| -------------- | -------- | ------------------------------------------------------------------ |
| `gcpProjectId` | Yes      | The GCP project ID used as both the JWT issuer suffix and audience |

## License

[MIT](LICENSE)
