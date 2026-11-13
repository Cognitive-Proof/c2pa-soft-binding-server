# @cognitiveproof/softbinding-api-plugin-vsmark

## 1.1.0

### Minor Changes

- [#21](https://github.com/Cognitive-Proof/c2pa-soft-binding-server/pull/21) [`7ec4e66`](https://github.com/Cognitive-Proof/c2pa-soft-binding-server/commit/7ec4e665bdd63491deb2faa024e69560adf4ecea) Thanks [@mrappard](https://github.com/mrappard)! - Add `encodeRepeated()`, which repeats the hidden block across the whole carrier text so any excerpt of `2 × (11 + message bytes) − 1` characters (93 for a UUID) still decodes.
