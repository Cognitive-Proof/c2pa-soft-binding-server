---
---

Add `isManifestAuthRequired` and `manifestHtmlRedirect` options to `createServer()` for `GET /manifests/:manifestId`: the first lets you mark individual manifests public or private (failing the check returns the same 404 as a nonexistent manifest, so private manifests don't reveal their existence), the second redirects browser (`Accept: text/html`) requests to an admin-supplied URL instead of returning the raw manifest bytes. Added `createOptionalJwtAuthMiddleware`/`resolveOptionalAuthMiddleware` to support per-request auth context without making auth mandatory.
