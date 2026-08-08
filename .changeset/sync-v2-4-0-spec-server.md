---
---

Sync the server and `openapi.yaml` with the C2PA Soft Binding Resolution API v2.4.0 spec:

- Add `GET /services/capabilities`, `GET /services/status` (with a new `getServiceStatus` config hook), and the root-level `GET /.well-known/c2pa-soft-binding-resolution` discovery endpoint.
- `GET /matches/byBinding` now returns `414` when `value` exceeds the new `maxQueryValueLength` config option (default 2048 characters), suggesting `POST` instead.
- `POST /matches/byReference` validates its `region` field against the spec's region-of-interest shapes (400 on malformed input) and forwards it to soft binding extractors.
- Receipts can now include an `anchor.parameters` object via `buildReceipt`.
- `openapi.yaml` is fully synced to v2.4.0 (new schemas/paths above, renamed `auth` security scheme, `414` response, typed `region` schema).
