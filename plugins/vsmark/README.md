# @cognitiveproof/softbinding-api-plugin-vsmark

Text-watermarking `Extractor` for [`@cognitiveproof/softbinding-api-server`](https://github.com/mrappard/c2pa-soft-binding-server) — the C2PA Soft Binding Resolution API server.

Hides a soft binding value inside plain-text or HTML content using invisible Unicode [variation selectors](<https://en.wikipedia.org/wiki/Variation_Selectors_(Unicode_block)>). The carrier text displays unchanged (variation selectors are invisible to renderers and ignored by most text processing), but a watermarked copy can be traced back to the original binding even after metadata is stripped.

## Install

```bash
npm install @cognitiveproof/softbinding-api-server @cognitiveproof/softbinding-api-plugin-vsmark
```

## Usage

Register `vsmarkExtractor` so the server can recover binding values from watermarked text assets via `POST /v1/matches/byContent` and `POST /v1/matches/byReference`:

```ts
import { createServer } from '@cognitiveproof/softbinding-api-server';
import { vsmarkExtractor, VSMARK_ALGORITHM } from '@cognitiveproof/softbinding-api-plugin-vsmark';

const app = createServer({
  extractors: { [VSMARK_ALGORITHM]: vsmarkExtractor },
});
```

When publishing an asset, embed the manifest's binding value into its text using `encode()`:

```ts
import { encode } from '@cognitiveproof/softbinding-api-plugin-vsmark';

const watermarkedArticle = encode(bindingValue, articleText);
```

`decode()` is also exported directly, for recovering a hidden value outside of `createServer()`:

```ts
import { decode } from '@cognitiveproof/softbinding-api-plugin-vsmark';

const bindingValue = decode(watermarkedArticle); // string | undefined
```

## API

| Export                               | Description                                                                                                                                                                                   |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vsmarkExtractor`                    | An `Extractor` (`(buffer, mimeType) => Promise<string \| null>`). Decodes `buffer` as UTF-8 and returns the hidden binding value, or `null` if the asset isn't text or contains no watermark. |
| `VSMARK_ALGORITHM`                   | The algorithm name `'com.cognitiveproof.vsmark.v1'`, for use as a key in `createServer({ extractors })` and reflected in `GET /v1/services/supportedAlgorithms`.                              |
| `encode(secretMessage, carrierText)` | Returns `carrierText` with `secretMessage` hidden inside it via invisible variation selectors.                                                                                                |
| `decode(text)`                       | Returns the hidden message previously embedded with `encode()`, or `undefined` if none is found.                                                                                              |

## How it works

Each byte of the message is encoded as one of 256 Unicode variation selectors (U+FE00–U+FE0F and U+E0100–U+E01EF) inserted after a character of the carrier text. The hidden payload is wrapped in a small framed format — a `"VSR1"` magic number, version byte, length-prefixed UTF-8 payload, and a CRC32 checksum — so `decode()` can reliably locate and validate the hidden data even if it's embedded partway through a larger text.

## License

[MIT](LICENSE)
