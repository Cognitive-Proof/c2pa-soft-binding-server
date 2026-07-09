# @cognitiveproof/softbinding-api-plugin-postgres

## 1.0.2

### Patch Changes

- [#8](https://github.com/Cognitive-Proof/c2pa-soft-binding-server/pull/8) [`66947ac`](https://github.com/Cognitive-Proof/c2pa-soft-binding-server/commit/66947ac913958e9f27dd6eb481fa44b3e17a13a7) Thanks [@mrappard](https://github.com/mrappard)! - Add a `createOptionalAuthMiddleware` export to the Google auth plugin: verifies the bearer token the same way as `createGoogleAuthMiddleware`, but never rejects the request, instead leaving the auth context unset for missing/invalid tokens. Used by the server's new per-manifest visibility check to see who's asking without making auth mandatory.

  Fixed `uuid` in the sqlite, mysql, postgres, and mongodb data store plugins, which had drifted to `uuid@14` (pure ESM) despite these plugins compiling to CommonJS — `require('uuid')` would throw at runtime. Pinned to `uuid@^11`, the actively maintained CJS-compatible major.
