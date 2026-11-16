# @cognitiveproof/softbinding-api-plugin-types

## 1.3.0

### Minor Changes

- [#26](https://github.com/Cognitive-Proof/c2pa-soft-binding-server/pull/26) [`cf31d16`](https://github.com/Cognitive-Proof/c2pa-soft-binding-server/commit/cf31d164812358e8aad08985d76b3fc46bb0a0c4) Thanks [@mrappard](https://github.com/mrappard)! - Add `readManifest` and `matchers` options. `readManifest` (a `ManifestReader`) validates each upload to `POST /manifests` and reports its manifest id and soft-binding blocks, superseding `parseManifestId`. A `MatcherPlugin` registered in `matchers` answers queries for its algorithm with its own index (e.g. similarity) instead of the data store's exact lookup, is listed by `supportedAlgorithms` under the kind it declares, and, with a `readManifest`, indexes each stored manifest's soft bindings for that algorithm automatically and drops them when the manifest is deleted. Byte-for-byte the same upload isn't indexed twice, and an upload whose binding the matcher refuses is not kept. `byContent` and `byReference` now pass `hintAlg` to the matcher with a hint value. The types package adds `ManifestReader`, `ManifestInfo`, `SoftBindingBlock`, `MatcherPlugin` and `InvalidSoftBindingValueError`. Also fixes `supportedAlgorithms` listing an extractor twice.

## 1.2.0

### Minor Changes

- [#15](https://github.com/Cognitive-Proof/c2pa-soft-binding-server/pull/15) [`ca45308`](https://github.com/Cognitive-Proof/c2pa-soft-binding-server/commit/ca45308505a007a357c24c1c8d8ee6b6ec434e0d) Thanks [@mrappard](https://github.com/mrappard)! - `DataStorePlugin.addManifest` accepts an optional explicit `manifestId`, used to store a manifest under a caller-supplied id instead of always generating a random one. All bundled storage plugins honor it when present and fall back to their previous random-id generation when it's omitted.

## 1.1.0

### Minor Changes

- [#11](https://github.com/Cognitive-Proof/c2pa-soft-binding-server/pull/11) [`1c0450f`](https://github.com/Cognitive-Proof/c2pa-soft-binding-server/commit/1c0450f5815177bc561d592e201c133b781c8746) Thanks [@mrappard](https://github.com/mrappard)! - Add `RegionOfInterest` (and its five variant types) for region-scoped soft binding queries, widen `Extractor` to accept an optional region argument, and add an optional `anchor.parameters` field to `Receipt`, per the C2PA Soft Binding Resolution API v2.4.0 spec.
