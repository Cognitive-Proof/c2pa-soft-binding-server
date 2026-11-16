# @cognitiveproof/softbinding-api-conformance

A black-box conformance test harness for the [C2PA Soft Binding Resolution API](https://spec.c2pa.org/specifications/specifications/2.4/softbinding/Decoupled.html). Point it at any server implementing the spec — not just this repo's — and it runs a suite of real HTTP requests against it to check the responses match what the spec requires.

## ⚠ This creates and deletes real data

Each run stores a handful of test manifests and bindings on the target, then deletes them again. **Point this at a sandbox or staging deployment, never production**, unless you're certain the credentials you're using are scoped to a throwaway tenant. Every fixture is a real C2PA Manifest Store, freshly signed for each upload, titled `softbinding-conformance-fixture:<uuid>` so any leftovers (e.g. from an interrupted run) are easy to identify.

Fixtures are signed with the c2pa-rs "FOR TESTING ONLY" sample ES256 certificate. A target that checks manifest structure and signatures should accept them; one that only accepts signers on a trust list will reject them, and the store suites will fail at fixture setup.

## Usage

```sh
npx @cognitiveproof/softbinding-api-conformance \
  --base-url https://staging.example.com/v1 \
  --token <bearer-token>
```

The token needs `fetch:manifests`, `store:manifests`, and `store:bindings` scopes for full coverage. If it's missing write scopes, the harness still runs — it discovers what the target supports via `GET /services/capabilities` and skips suites it can't exercise (see below).

### Options

| Flag                  | Description                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------------ |
| `--base-url <url>`    | **Required.** Base URL of the target's `/v1` API.                                                      |
| `--token <bearer>`    | **Required.** Bearer token to authenticate with.                                                       |
| `--no-cleanup`        | Leave created fixture manifests in place, for debugging a failure.                                     |
| `--anonymous-uploads` | The target accepts `POST /manifests` without a token. Skips the checks that such uploads are rejected. |
| `--json`              | Emit Jest's JSON reporter output instead of the default.                                               |

Exit code is non-zero if any check fails — safe to wire into CI.

## What it checks

Per the spec, only one query endpoint plus `GET /manifests/{id}` are mandatory — everything else is optional. The harness calls `GET /services/capabilities` up front and skips suites for capabilities the target doesn't report, rather than failing them.

`/services/capabilities`, `/services/status` and `/.well-known/c2pa-soft-binding-resolution` were added to the spec after the [published 2.4 version](https://spec.c2pa.org/specifications/specifications/2.4/softbinding/Decoupled.html). If the target has no `/services/capabilities`, the harness treats it as a 2.4 server: it skips the checks for those three endpoints and assumes every optional capability is present.

- **Discovery** — `/services/supportedAlgorithms` responds with the documented shape; on targets that serve them, so do `/services/capabilities`, `/services/status` and the root-level `/.well-known/c2pa-soft-binding-resolution`.

- **Manifests** — unknown manifest IDs 404; when `storeManifests` is supported, store → fetch → delete round-trips correctly and a deleted manifest answers `404` (what the spec documents) or `410 Gone` afterward.
- **Auth** — `POST /manifests` rejects a missing or garbage bearer token, and `DELETE /manifests/{id}` without a token is rejected and leaves the manifest in place. The spec documents `403` for this and no `401`, so either passes. Use `--anonymous-uploads` for a target that accepts uploads without a token. `GET /manifests/{id}` is checked leniently (`200`/`401`/`403`/`404` all pass), since the spec allows per-manifest public/private policy.
- **Bindings** — when `storeBindings` is supported, a binding can be created, found via `GET /matches/byBinding`, and updated; binding to an unknown manifest 404s.
- **Receipts** — when `storeManifests` is supported, `returnReceipt=true` produces a receipt that's retrievable and verifies successfully.

This first version deliberately covers the mandatory path plus the capabilities above — optional query endpoints (`byContent`, `byReference`) and scope-granularity testing (confirming a fetch-only token gets `403` on store operations) aren't covered yet.

## Reading a failure

Each check is a normal Jest test — a failure prints the expected vs. actual status code or response shape, same as any Jest run. Suites skipped because the target doesn't report a capability show up as `skipped`, not `failed`.

If a run is interrupted before cleanup finishes, re-run with `--no-cleanup` to leave fixtures in place while you inspect the target directly, then manually delete anything tagged `softbinding-conformance-fixture:*`.
