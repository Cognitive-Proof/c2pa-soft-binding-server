---
'@cognitiveproof/softbinding-api-plugin-google-auth': minor
'@cognitiveproof/softbinding-api-plugin-sqlite': patch
'@cognitiveproof/softbinding-api-plugin-mysql': patch
'@cognitiveproof/softbinding-api-plugin-postgres': patch
'@cognitiveproof/softbinding-api-plugin-mongodb': patch
---

Add a `createOptionalAuthMiddleware` export to the Google auth plugin: verifies the bearer token the same way as `createGoogleAuthMiddleware`, but never rejects the request, instead leaving the auth context unset for missing/invalid tokens. Used by the server's new per-manifest visibility check to see who's asking without making auth mandatory.

Fixed `uuid` in the sqlite, mysql, postgres, and mongodb data store plugins, which had drifted to `uuid@14` (pure ESM) despite these plugins compiling to CommonJS — `require('uuid')` would throw at runtime. Pinned to `uuid@^11`, the actively maintained CJS-compatible major.
