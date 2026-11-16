---
'@cognitiveproof/softbinding-api-server': minor
'@cognitiveproof/softbinding-api-plugin-types': minor
---

Add `readManifest` and `matchers` options. `readManifest` (a `ManifestReader`) validates each upload to `POST /manifests` and reports its manifest id and soft-binding blocks, superseding `parseManifestId`. A `MatcherPlugin` registered in `matchers` answers queries for its algorithm with its own index (e.g. similarity) instead of the data store's exact lookup, is listed by `supportedAlgorithms` under the kind it declares, and, with a `readManifest`, indexes each stored manifest's soft bindings for that algorithm automatically and drops them when the manifest is deleted. Byte-for-byte the same upload isn't indexed twice, and an upload whose binding the matcher refuses is not kept. `byContent` and `byReference` now pass `hintAlg` to the matcher with a hint value. The types package adds `ManifestReader`, `ManifestInfo`, `SoftBindingBlock`, `MatcherPlugin` and `InvalidSoftBindingValueError`. Also fixes `supportedAlgorithms` listing an extractor twice.
