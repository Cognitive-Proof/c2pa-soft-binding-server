# @cognitiveproof/softbinding-api-plugin-c2pa-manifest

## 1.0.1

### Patch Changes

- [#27](https://github.com/Cognitive-Proof/c2pa-soft-binding-server/pull/27) [`676393d`](https://github.com/Cognitive-Proof/c2pa-soft-binding-server/commit/676393dad11064598a171535232b2602e381fea0) Thanks [@mrappard](https://github.com/mrappard)! - Read soft-binding values that c2pa-rs reports as `b64'…'`. c2pa-rs writes byte strings in its JSON report that way, so the reader skipped every block of manifests read through c2pa-node and nothing was indexed.

- Updated dependencies [[`cf31d16`](https://github.com/Cognitive-Proof/c2pa-soft-binding-server/commit/cf31d164812358e8aad08985d76b3fc46bb0a0c4)]:
  - @cognitiveproof/softbinding-api-plugin-types@1.3.0
