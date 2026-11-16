# @cognitiveproof/softbinding-api-conformance

## 1.1.0

### Minor Changes

- [#24](https://github.com/Cognitive-Proof/c2pa-soft-binding-server/pull/24) [`ed66e7d`](https://github.com/Cognitive-Proof/c2pa-soft-binding-server/commit/ed66e7d96eb6a500973586be395ed4276672b3b2) Thanks [@mrappard](https://github.com/mrappard)! - Make the conformance harness run from its npm package and match the Soft Binding Resolution API spec:

  - The published package now runs: it ships `src`, and Jest no longer skips its tests because they live under `node_modules`.
  - Fixtures are real C2PA Manifest Stores, signed fresh for each upload with the c2pa-rs sample test certificate, so stores that validate uploads or derive the manifest id from the manifest accept them.
  - Rejected requests to store routes may answer `401` or `403`; the spec documents `403`. `DELETE` without a token is now checked against a real manifest, which must still exist afterward.
  - New `--anonymous-uploads` flag skips the upload auth checks for stores that accept anonymous uploads.
  - A deleted manifest may answer `404` or `410`.
  - Targets without `/services/capabilities` are treated as published-2.4 servers, and the checks for `/services/capabilities`, `/services/status` and the well-known document, which were added after 2.4, are skipped.
