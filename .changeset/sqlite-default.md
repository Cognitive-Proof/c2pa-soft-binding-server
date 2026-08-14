---
'@cognitiveproof/softbinding-api-server': minor
---

The default data store is now the bundled SQLite plugin instead of MongoDB. `@cognitiveproof/softbinding-api-plugin-sqlite` is now a real (non-peer) dependency of this package, so `npm install @cognitiveproof/softbinding-api-server` alone gives you a working data store with zero extra installs or configuration — it writes to `./data/softbinding.sqlite` by default (override with `SQLITE_DB_PATH` or the `dataStore` option).

To keep using MongoDB (or switch to Postgres/MySQL), install the corresponding plugin package and set `DATASTORE_PLUGIN`/`dataStore` explicitly — this was already required for every backend other than the previous default, and still works the same way.
