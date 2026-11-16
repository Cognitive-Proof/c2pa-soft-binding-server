# @cognitiveproof/softbinding-api-plugin-iscc

[ISCC](https://iscc.codes) (ISO 24138) soft bindings for [`@cognitiveproof/softbinding-api-server`](https://github.com/Cognitive-Proof/c2pa-soft-binding-server): the `io.iscc.v0` algorithm as specified by [IEP-0020](https://ieps.iscc.codes/iep-0020/). Provides a `MatcherPlugin` that finds manifests by ISCC similarity and an `Extractor` that generates an ISCC from an asset. ISCC codes are generated with [`@iscc/lib`](https://www.npmjs.com/package/@iscc/lib), the ISCC Foundation's Rust implementation.

## Install

```bash
npm install @cognitiveproof/softbinding-api-server @cognitiveproof/softbinding-api-plugin-iscc
```

`@iscc/lib` ships prebuilt binaries for macOS (arm64, x64), Linux glibc (x64, arm64) and Windows x64. Alpine (musl) images aren't covered; use a Debian-based Node image.

## Usage

```ts
import { createServer } from '@cognitiveproof/softbinding-api-server';
import { createC2paManifestReader } from '@cognitiveproof/softbinding-api-plugin-c2pa-manifest';
import {
  createMongoUnitStore,
  isccExtractor,
  isccMatcher,
  ISCC_ALGORITHM,
} from '@cognitiveproof/softbinding-api-plugin-iscc';

const app = createServer({
  // Reads each uploaded manifest's io.iscc.v0 soft bindings so they're indexed automatically.
  readManifest: createC2paManifestReader(),
  matchers: {
    [ISCC_ALGORITHM]: isccMatcher({ store: createMongoUnitStore(db.collection('isccUnits')) }),
  },
  // Lets POST /v1/matches/byContent?alg=io.iscc.v0 generate an ISCC from the asset.
  extractors: { [ISCC_ALGORITHM]: isccExtractor },
});
```

Then query with the base64 of an ISCC-SEQ:

```bash
curl -X POST "$SERVER/v1/matches/byBinding" -H 'Content-Type: application/json' \
  -d '{"alg": "io.iscc.v0", "value": "AAdXjHyPv721jyn2Pv6zhxVT+qdf+XRY1J7/XuTd82u2ySAHqIJIxTqFLI1+nFRwR8mjbEBStqyr7x4qTOFeWG4MswUwBwW0HzRySTIl0n7cvbYyNoRqU+4o3speNWGswMm734G1QAelIq9KLJy/aoCJJK/SrPoHkzR7k2Z49ZguIv3T3UoONw=="}'
```

## Matching

Values are ISCC-SEQs (concatenated ISCC-UNITs) in base64; standard or URL-safe, with or without padding. Matching follows IEP-0020:

- Only 256-bit Semantic-, Content-, Data- and Instance-Codes take part. Meta-Codes and shorter units are ignored, and so are featureless Image-Codes.
- Units are compared with stored units of the same MainType, SubType and Version: Instance-Codes for equality, the others by similarity ⌊100 × (256 − d) / 256⌋, where d is the number of differing bits.
- A manifest scores 100 if an Instance-Code is equal (an exact match). Otherwise its score is its best similarity, capped at 99, if that reaches the threshold (default 80).
- Matches are returned best first.

A query value that isn't a valid ISCC-SEQ, holds nothing to compare, or holds more than 32 searchable units gets a `400`. When indexing, malformed values and blocks with a non-empty `scope` are skipped (IEP-0020 says to ignore them), and a value with more than 32 searchable units refuses the upload.

Each query compares against every stored unit of the same type. That's quick for thousands of manifests; a large catalog needs an approximate nearest-neighbour index behind the same `UnitStore` interface.

An ISCC has no integrity protection of its own, and anyone can copy an Instance-Code into another manifest: a match shows the content is the same or similar, not who created it. Check the signer of each matching manifest.

## Unit stores

| Store                               | Use                                                                                      |
| ----------------------------------- | ---------------------------------------------------------------------------------------- |
| `createMemoryUnitStore()` (default) | Tests and single instances. Lost on restart, and not shared between instances.           |
| `createMongoUnitStore(collection)`  | Any MongoDB driver `Collection`; creates its indexes on first use.                       |
| Your own `UnitStore`                | `add(manifestId, units)`, `remove(manifestId)`, `byKey(key)` over `{ key, body }` units. |

## Extractor

`isccExtractor` generates an ISCC-SEQ from the asset bytes: its Data-Code and Instance-Code, plus a Text Content-Code for `text/*` assets that decode as UTF-8. The codes are identical to Python `iscc-core` 1.5.0. Image, audio and video Content-Codes need decoded media and aren't generated yet; such assets still match exactly by Instance-Code and closely by Data-Code.

## Codec

`decodeSeq`, `encodeSeq`, `unitToString`, `base32Encode`/`base32Decode`, `isFeatureless` and `similarity` are exported too. The decoder implements IEP-0020's rules, including its rejection test vectors, and keeps units with an unknown SubType or Version.
