// ISCC-SEQ codec (IEP-0020): concatenated ISCC-UNITs, each an ISCC-HEADER in
// the variable-length nibble encoding of ISO 24138:2024 followed by its
// ISCC-BODY. https://ieps.iscc.codes/iep-0020/

export const MAINTYPE = { META: 0, SEMANTIC: 1, CONTENT: 2, DATA: 3, INSTANCE: 4 } as const;
/** Content-Code SubType for images. */
export const SUBTYPE_IMAGE = 1;

export interface IsccUnit {
  maintype: number;
  subtype: number;
  version: number;
  /** Length field: the body has 32 × (length + 1) bits. */
  length: number;
  body: Buffer;
}

export class InvalidIsccSeqError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidIsccSeqError';
  }
}

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** RFC 4648 base32 without padding, as ISCC uses. */
export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = ((value << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of text.toUpperCase()) {
    const index = BASE32.indexOf(char);
    if (index < 0)
      throw new InvalidIsccSeqError(`Invalid base32 character ${JSON.stringify(char)}`);
    value = ((value << 5) | index) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Reads bits from a byte array, most significant first. */
class BitReader {
  offset = 0;
  constructor(private readonly bytes: Uint8Array) {}

  get remaining(): number {
    return this.bytes.length * 8 - this.offset;
  }

  read(count: number): number {
    if (count > this.remaining) throw new InvalidIsccSeqError('ISCC-HEADER is truncated');
    let value = 0;
    for (let i = 0; i < count; i++, this.offset++) {
      value = (value << 1) | ((this.bytes[this.offset >> 3] >> (7 - (this.offset & 7))) & 1);
    }
    return value;
  }
}

// Variable-length nibbles: 0xxx (0–7), 10xxxxxx (8–71), 110xxxxxxxxx (72–583),
// 1110xxxxxxxxxxxxxxx… (584–4679).
const VARNIBBLE = [
  { prefix: 0b0, prefixBits: 1, bits: 3, base: 0 },
  { prefix: 0b10, prefixBits: 2, bits: 6, base: 8 },
  { prefix: 0b110, prefixBits: 3, bits: 9, base: 72 },
  { prefix: 0b1110, prefixBits: 4, bits: 12, base: 584 },
];

function readVarnibble(reader: BitReader): number {
  for (const form of VARNIBBLE) {
    // The prefix is a run of 1s ended by a 0; peek one bit at a time.
    const bit = reader.read(1);
    if (bit === 0) return form.base + reader.read(form.bits);
  }
  throw new InvalidIsccSeqError('ISCC-HEADER field exceeds the varnibble range');
}

function writeVarnibble(bits: number[], value: number): void {
  const form = [...VARNIBBLE].reverse().find((f) => value >= f.base);
  if (!form || value >= form.base + 2 ** form.bits) {
    throw new InvalidIsccSeqError(`ISCC-HEADER field ${value} is out of range`);
  }
  for (let i = form.prefixBits - 1; i >= 0; i--) bits.push((form.prefix >> i) & 1);
  const v = value - form.base;
  for (let i = form.bits - 1; i >= 0; i--) bits.push((v >> i) & 1);
}

/** The canonical ISCC-HEADER bytes of the given fields. */
export function encodeHeader(
  maintype: number,
  subtype: number,
  version: number,
  length: number,
): Buffer {
  const bits: number[] = [];
  for (const field of [maintype, subtype, version, length]) writeVarnibble(bits, field);
  while (bits.length % 8) bits.push(0);
  const out = Buffer.alloc(bits.length / 8);
  bits.forEach((bit, i) => (out[i >> 3] |= bit << (7 - (i & 7))));
  return out;
}

/** The bytes of one ISCC-UNIT: header then body. */
export function encodeUnit(unit: IsccUnit): Buffer {
  return Buffer.concat([
    encodeHeader(unit.maintype, unit.subtype, unit.version, unit.length),
    unit.body,
  ]);
}

/** Decodes an ISCC-SEQ into its ISCC-UNITs, in order, rejecting what IEP-0020 rejects. */
export function decodeSeq(bytes: Uint8Array): IsccUnit[] {
  if (bytes.length === 0) throw new InvalidIsccSeqError('ISCC-SEQ holds no ISCC-UNIT');
  const units: IsccUnit[] = [];
  let offset = 0;

  while (offset < bytes.length) {
    const reader = new BitReader(bytes.subarray(offset));
    const [maintype, subtype, version, length] = [0, 0, 0, 0].map(() => readVarnibble(reader));
    const headerBytes = Math.ceil(reader.offset / 8);
    const header = encodeHeader(maintype, subtype, version, length);
    if (
      header.length !== headerBytes ||
      !header.equals(Buffer.from(bytes.subarray(offset, offset + headerBytes)))
    ) {
      throw new InvalidIsccSeqError('ISCC-HEADER is not in canonical form');
    }
    if (maintype > MAINTYPE.INSTANCE) {
      throw new InvalidIsccSeqError(`MainType ${maintype} is not allowed in an ISCC-SEQ`);
    }
    if (length > 7) throw new InvalidIsccSeqError(`Length field ${length} exceeds 7`);

    const bodyStart = offset + headerBytes;
    const bodyEnd = bodyStart + 4 * (length + 1);
    if (bodyEnd > bytes.length) throw new InvalidIsccSeqError('ISCC-BODY is truncated');
    units.push({
      maintype,
      subtype,
      version,
      length,
      body: Buffer.from(bytes.subarray(bodyStart, bodyEnd)),
    });
    offset = bodyEnd;
  }
  return units;
}

/** Encodes ISCC-UNITs (as `ISCC:…` strings or units) into an ISCC-SEQ. */
export function encodeSeq(units: Array<string | IsccUnit>): Buffer {
  return Buffer.concat(
    units.map((unit) =>
      typeof unit === 'string' ? base32Decode(unit.replace(/^ISCC:/, '')) : encodeUnit(unit),
    ),
  );
}

/** The canonical `ISCC:…` string of a unit. */
export function unitToString(unit: IsccUnit): string {
  return `ISCC:${base32Encode(encodeUnit(unit))}`;
}
