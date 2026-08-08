---
'@cognitiveproof/softbinding-api-plugin-types': minor
'@cognitiveproof/softbinding-api-plugin-sqlite': patch
'@cognitiveproof/softbinding-api-plugin-postgres': patch
'@cognitiveproof/softbinding-api-plugin-mysql': patch
'@cognitiveproof/softbinding-api-plugin-mongodb': patch
---

`DataStorePlugin.addManifest` accepts an optional explicit `manifestId`, used to store a manifest under a caller-supplied id instead of always generating a random one. All bundled storage plugins honor it when present and fall back to their previous random-id generation when it's omitted.
