---
---

Add a `parseManifestId` option to `createServer()`, letting the maintainer supply a function that derives the real manifest id embedded in an uploaded C2PA Manifest Store, instead of always assigning a random one. `POST /manifests` uses it when configured: a parse failure returns 400; uploading the same id with identical bytes succeeds idempotently; uploading the same id with different bytes is rejected as a label conflict (400).
