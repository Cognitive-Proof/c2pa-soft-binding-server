---
'@cognitiveproof/softbinding-api-plugin-c2pa-manifest': patch
---

Read soft-binding values that c2pa-rs reports as `b64'…'`. c2pa-rs writes byte strings in its JSON report that way, so the reader skipped every block of manifests read through c2pa-node and nothing was indexed.
