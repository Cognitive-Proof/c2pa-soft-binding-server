# @cognitiveproof/softbinding-api-plugin-google-service-account-auth

Google service-account `AuthPlugin` for [`@cognitiveproof/softbinding-api-server`](https://github.com/mrappard/c2pa-soft-binding-server) — the C2PA Soft Binding Resolution API server.

Authenticates machine callers, such as a signing service on Cloud Run, that send a Google-signed **ID token** (for example from the Cloud Run metadata server). These tokens have:

- **issuer**: `https://accounts.google.com`
- **audience**: whatever the caller requested — normally this server's public URL
- **email**: the service account's email
- no `scope` claim

ID tokens carry no scopes, so this plugin maps each allowed service-account email to the scopes it is granted. Any Google service account can mint an ID token for any audience, so **the allowlist is what grants access**: valid tokens from unlisted accounts get `403`.

| Situation                                                         | Response |
| ----------------------------------------------------------------- | -------- |
| No bearer token                                                   | `401`    |
| Bad signature, wrong issuer, wrong audience                       | `401`    |
| Expired token                                                     | `401`    |
| Valid token, email not allowlisted or `email_verified` not `true` | `403`    |
| Valid token, allowlisted, but route needs a missing scope         | `403`    |

## Install

```bash
npm install @cognitiveproof/softbinding-api-server @cognitiveproof/softbinding-api-plugin-google-service-account-auth
```

## Usage

```ts
import { createServer } from '@cognitiveproof/softbinding-api-server';
import createServiceAccountAuthMiddleware from '@cognitiveproof/softbinding-api-plugin-google-service-account-auth';

const app = createServer({
  auth: createServiceAccountAuthMiddleware({
    audience: 'https://softbinding.example',
    accounts: {
      'c2pa-signer@PROJECT.iam.gserviceaccount.com': [
        'store:manifests',
        'store:bindings',
        'store:originals',
        'fetch:manifests',
      ],
    },
  }),
});
```

### Also accepting other callers

Pass `fallback` to hand any request whose token was **not** issued by `accounts.google.com` (or that has no bearer token) to another middleware, such as the Identity Platform plugin:

```ts
import createGoogleAuthMiddleware from '@cognitiveproof/softbinding-api-plugin-google-auth';

createServiceAccountAuthMiddleware({
  audience: process.env.REPO_URI!,
  accounts,
  fallback: createGoogleAuthMiddleware(process.env.GCP_PROJECT_ID!),
});
```

Google-issued tokens are always verified by this plugin and never fall through.

### Configuration from the environment

`serviceAccountAuthOptionsFromEnv()` reads:

| Variable           | Description                                                                                                                |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `SA_AUTH_AUDIENCE` | Expected `aud` — this server's public URL. Required when `SA_AUTH_ACCOUNTS` is set.                                        |
| `SA_AUTH_ACCOUNTS` | JSON object of email → scopes, e.g. `{"c2pa-signer@PROJECT.iam.gserviceaccount.com":["store:manifests","store:bindings"]}` |

It returns `undefined` when `SA_AUTH_ACCOUNTS` is unset, and throws if either value is invalid. The server's bundled CLI (`softbinding-api-server`) uses it automatically when `SA_AUTH_ACCOUNTS` is set.

## Options

| Option     | Required | Description                                                                 |
| ---------- | -------- | --------------------------------------------------------------------------- |
| `audience` | Yes      | Expected `aud` claim                                                        |
| `accounts` | Yes      | Service-account email → granted scopes                                      |
| `fallback` | No       | Middleware for non-Google-issued tokens and requests without a bearer token |
| `jwksUri`  | No       | JWKS endpoint. Default: `https://www.googleapis.com/oauth2/v3/certs`        |

## License

[MIT](LICENSE)
