# @cognitiveproof/softbinding-api-plugin-c2pa-manifest

C2PA Manifest Store reader for [`@cognitiveproof/softbinding-api-server`](https://github.com/Cognitive-Proof/c2pa-soft-binding-server): validates each manifest uploaded to `POST /v1/manifests` with [c2pa-rs](https://github.com/contentauth/c2pa-rs) (through [`@contentauth/c2pa-node`](https://www.npmjs.com/package/@contentauth/c2pa-node)) and reports its manifest id, its soft-binding blocks and whether its signer is trusted.

## Install

```bash
npm install @cognitiveproof/softbinding-api-server @cognitiveproof/softbinding-api-plugin-c2pa-manifest
```

Needs Node.js 22.12 or later. `@contentauth/c2pa-node` downloads a prebuilt native library from GitHub when it's installed, so the install step needs network access (see its README for `C2PA_LIBRARY_PATH` and `SKIP_BINARY_DOWNLOAD`).

## Usage

```ts
import fs from 'fs';
import { createServer } from '@cognitiveproof/softbinding-api-server';
import { createC2paManifestReader } from '@cognitiveproof/softbinding-api-plugin-c2pa-manifest';

const app = createServer({
  readManifest: createC2paManifestReader({
    trustAnchors: fs.readFileSync('C2PA-TRUST-LIST.pem', 'utf8'),
  }),
});
```

| Option           | Default | Meaning                                                                                       |
| ---------------- | ------- | --------------------------------------------------------------------------------------------- |
| `trustAnchors`   | none    | PEM certificates that signing credentials are checked against, e.g. the C2PA trust list       |
| `requireTrusted` | `false` | Refuse manifests whose signing credential isn't trusted, instead of storing them as untrusted |
| `allowExpired`   | `true`  | Accept a credential that has expired (without a trusted time stamp), as untrusted             |

With a matcher registered for an algorithm (e.g. `io.iscc.v0` from `@cognitiveproof/softbinding-api-plugin-iscc`), the server indexes the manifest's soft bindings for that algorithm automatically.

## What it accepts

Only the Manifest Store is uploaded, never the asset, so hard-binding failures (`assertion.dataHash.mismatch` and the other hash mismatches) are expected and tolerated. The upload is refused (`400`, with the C2PA status code) when:

- c2pa-rs can't read it, or bytes follow the Manifest Store's outer JUMBF box;
- it has no active manifest, or the active manifest's label is longer than 255 characters or not printable;
- the claim signature isn't verified, or the active manifest has any other validation failure, such as an assertion changed after signing (`assertion.hashedURI.mismatch`);
- an ingredient manifest was changed after signing;
- the signer isn't trusted and `requireTrusted` is set, or the credential expired and `allowExpired` is `false`.

Reading is offline: remote manifest fetching, OCSP and CAWG identity assertion decoding are turned off, so an upload can't make the server fetch URLs or DID documents it names.

## Soft-binding values

Each block is reported with its `alg`, its value as base64 and its `scope` (omitted when empty). The C2PA specification defines the value as a byte string, which c2pa-rs reports as base64, and some writers produce an array of byte values, which is converted. Blocks whose value is plain text that isn't base64 (as some TrustMark assertions write it) are skipped.

## Exports

- `createC2paManifestReader(options)`: the `ManifestReader`.
- `checkReport(report, options)`, `checkLength(data)`, `softBindings(assertions)`, `readerSettings(trustAnchors)`: the steps it applies, for use with your own c2pa-rs report.
- `InvalidManifestError`: thrown for a refused upload, with the status `code`.
