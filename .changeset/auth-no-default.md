---
'@cognitiveproof/softbinding-api-server': major
---

**Breaking:** `createServer()` no longer auto-loads an `AuthPlugin` when `auth` is omitted. Previously, omitting `auth` (with a `gcpProjectId`/`GCP_PROJECT_ID`) silently required the bundled `@cognitiveproof/softbinding-api-plugin-google-auth` package and verified Google Identity Platform JWTs by default; if neither `auth` nor a GCP project id was configured, `createServer()` threw at startup.

Now, omitting `auth` means every request to `/v1` routes is treated as fully authorized — no identity verification is performed at all — and a warning is logged once at startup via the configured `logger` so this doesn't go unnoticed. This is intended for local development only.

To require real auth, pass `auth` explicitly. For the previous Google Identity Platform behavior, install `@cognitiveproof/softbinding-api-plugin-google-auth` yourself and wire it in:

```ts
import createGoogleAuthMiddleware from '@cognitiveproof/softbinding-api-plugin-google-auth';

createServer({ auth: createGoogleAuthMiddleware(process.env.GCP_PROJECT_ID) });
```

The `gcpProjectId` option and the `AUTH_PLUGIN` environment variable have been removed — there is no longer an implicit `require()` of an auth package by name. `resolveOptionalAuthMiddleware` (used for `isManifestAuthRequired`) no longer takes a `gcpProjectId` argument either.
