// Hides a UTF-8 payload (e.g. a soft binding value) inside a piece of text by
// encoding each payload byte as a Unicode variation selector appended after
// the preceding character. Variation selectors are invisible and are ignored
// by most renderers, so the carrier text displays unchanged while carrying
// the hidden payload.
//
// Wire format (before variation-selector encoding):
//   "VSR1" magic (4 bytes) | version (1 byte) | payload length (2 bytes, big-endian)
//   | payload (UTF-8 bytes) | CRC32 of the preceding bytes (4 bytes, big-endian)

function buildCrc32Table(): Uint32Array {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c;
  }
  return table;
}

const CRC32_TABLE = buildCrc32Table();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function byteToVariationSelector(byte: number): string {
  if (byte < 16) {
    return String.fromCodePoint(0xfe00 + byte);
  }
  return String.fromCodePoint(0xe0100 + byte - 16);
}

function variationSelectorToByte(codePoint: number): number | undefined {
  if (codePoint >= 0xfe00 && codePoint <= 0xfe0f) {
    return codePoint - 0xfe00;
  }
  if (codePoint >= 0xe0100 && codePoint <= 0xe01ef) {
    return 16 + (codePoint - 0xe0100);
  }
  return undefined;
}

function removeVariationSelectors(text: string): string {
  const chars: string[] = [];
  for (const char of text) {
    const cp = char.codePointAt(0)!;
    if (variationSelectorToByte(cp) === undefined) {
      chars.push(char);
    }
  }
  return chars.join('');
}

/**
 * Hides `secretMessage` inside `carrierText` using invisible Unicode
 * variation selectors. Returns the carrier text unchanged (minus any
 * pre-existing variation selectors) if it's too short to carry the message.
 */
export function encode(secretMessage: string, carrierText: string): string {
  const encoder = new TextEncoder();
  const payload = encoder.encode(secretMessage);

  if (payload.length > 65535) {
    throw new Error('Secret message exceeds maximum size of 65535 UTF-8 bytes');
  }

  const magic = new Uint8Array([0x56, 0x53, 0x52, 0x31]); // "VSR1"
  const version = new Uint8Array([0x01]);
  const lengthBytes = new Uint8Array([payload.length >> 8, payload.length & 0xff]);

  const headerAndPayload = new Uint8Array(7 + payload.length);
  headerAndPayload.set(magic, 0);
  headerAndPayload.set(version, 4);
  headerAndPayload.set(lengthBytes, 5);
  headerAndPayload.set(payload, 7);

  const checksum = crc32(headerAndPayload);
  const crcBytes = new Uint8Array([
    (checksum >>> 24) & 0xff,
    (checksum >>> 16) & 0xff,
    (checksum >>> 8) & 0xff,
    checksum & 0xff,
  ]);

  const secretBlock = new Uint8Array(headerAndPayload.length + 4);
  secretBlock.set(headerAndPayload, 0);
  secretBlock.set(crcBytes, headerAndPayload.length);

  const cleanedCarrier = removeVariationSelectors(carrierText);
  const carrierChars = [...cleanedCarrier];

  if (carrierChars.length < secretBlock.length) {
    return cleanedCarrier;
  }

  const result: string[] = [];
  for (let i = 0; i < carrierChars.length; i++) {
    result.push(carrierChars[i]);
    if (i < secretBlock.length) {
      result.push(byteToVariationSelector(secretBlock[i]));
    }
  }

  return result.join('');
}

/**
 * Recovers a message previously hidden with `encode()`, by scanning `text`
 * for variation selectors that decode to a valid "VSR1" block (magic,
 * version, length-prefixed payload, and matching CRC32). Returns `undefined`
 * if no valid block is found.
 */
export function decode(text: string): string | undefined {
  const hiddenBytes: number[] = [];

  for (const char of text) {
    const cp = char.codePointAt(0)!;
    const byte = variationSelectorToByte(cp);
    if (byte !== undefined) {
      hiddenBytes.push(byte);
    }
  }

  const minimumLength = 11;

  for (let start = 0; start <= hiddenBytes.length - minimumLength; start++) {
    if (
      hiddenBytes[start] !== 0x56 ||
      hiddenBytes[start + 1] !== 0x53 ||
      hiddenBytes[start + 2] !== 0x52 ||
      hiddenBytes[start + 3] !== 0x31
    ) {
      continue;
    }

    if (hiddenBytes[start + 4] !== 0x01) {
      continue;
    }

    const payloadLength = (hiddenBytes[start + 5] << 8) | hiddenBytes[start + 6];
    const payloadStart = start + 7;
    const payloadEnd = payloadStart + payloadLength;
    const blockEnd = payloadEnd + 4;

    if (blockEnd > hiddenBytes.length) {
      continue;
    }

    const storedCrc =
      ((hiddenBytes[payloadEnd] << 24) |
        (hiddenBytes[payloadEnd + 1] << 16) |
        (hiddenBytes[payloadEnd + 2] << 8) |
        hiddenBytes[payloadEnd + 3]) >>>
      0;

    const actualCrc = crc32(new Uint8Array(hiddenBytes.slice(start, payloadEnd)));

    if (storedCrc === actualCrc) {
      const decoder = new TextDecoder();
      return decoder.decode(new Uint8Array(hiddenBytes.slice(payloadStart, payloadEnd)));
    }
  }

  return undefined;
}
