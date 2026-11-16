import {
  createMemoryUnitStore,
  createMongoUnitStore,
  decodeBase64,
  decodeSeq,
  encodeSeq,
  isccExtractor,
  isccMatcher,
  isFeatureless,
  similarity,
  unitToString,
  type IsccUnit,
  type UnitCollection,
  type UnitDocument,
} from '../index';

// IEP-0020 test vectors (https://ieps.iscc.codes/iep-0020/#test-vectors).
const META = 'ISCC:AADVPDD4R6733NMPFH3D57VTQ4KVH6VHL74XIWGUT37V5ZG56NV3NSI';
const CONTENT = 'ISCC:EAD2RASIYU5IKLENP2OFI4CHZGRWYQCSW2WKX3Y6FJGOCXSYNYGLGBI';
const DATA = 'ISCC:GADQLNA7GRZESMRF2J7NZPNWGI3II2ST5YUN5SS6GVQ2ZQGJXPPYDNI';
const INSTANCE = 'ISCC:IAD2KIVPJIWJZP3KQCESJL6SVT5APEZUPOJWM6HVTAXCF7OT3VFA4NY';
const VECTOR_HEX =
  '0007578c7c8fbfbdb58f29f63efeb3871553faa75ff97458d49eff5ee4ddf36bb6c92007a88248c53a852c8d7e9c547047c9a36c4052b6acabef1e2a4ce15e586e0cb305300705b41f3472493225d27edcbdb63236846a53ee28deca5e3561acc0c9bbdf81b54007a522af4a2c9cbf6a808924afd2acfa0793347b936678f5982e22fdd3dd4a0e37';
const VECTOR_BASE64 =
  'AAdXjHyPv721jyn2Pv6zhxVT+qdf+XRY1J7/XuTd82u2ySAHqIJIxTqFLI1+nFRwR8mjbEBStqyr7x4qTOFeWG4MswUwBwW0HzRySTIl0n7cvbYyNoRqU+4o3speNWGswMm734G1QAelIq9KLJy/aoCJJK/SrPoHkzR7k2Z49ZguIv3T3UoONw==';

// Generated with Python iscc-core 1.5.0 from TEXT (Text-, Data- and Instance-Code).
const TEXT = 'The quick brown fox jumps over the lazy dog. ISCC soft binding test text.';
const TEXT_SEQ_BASE64 =
  'IAfq87t2Y4ODZY4c7DZCa4g9GzYEYG+5jikLB4LU8dsN/zAHtxMjOfSP8+Q59Rco6fITSe4mFtAVbN4WNVOI1efXgu9AB2ArvZj4Mkb1rKqjO/2mZ+uoCQke6JDTmRERqTVeDxRI';

/** The unit with the first `bits` bits of its body inverted. */
function flip(iscc: string, bits: number): string {
  const [unit] = decodeSeq(encodeSeq([iscc]));
  const body = Buffer.from(unit.body);
  for (let i = 0; i < bits; i++) body[i >> 3] ^= 0x80 >> (i & 7);
  return unitToString({ ...unit, body });
}

const seq = (...units: string[]) => encodeSeq(units).toString('base64');

describe('ISCC-SEQ codec (IEP-0020)', () => {
  it('encodes and decodes the test vector in order', () => {
    expect(encodeSeq([META, CONTENT, DATA, INSTANCE]).toString('hex')).toBe(VECTOR_HEX);
    expect(encodeSeq([META, CONTENT, DATA, INSTANCE]).toString('base64')).toBe(VECTOR_BASE64);
    expect(decodeSeq(Buffer.from(VECTOR_HEX, 'hex')).map(unitToString)).toEqual([
      META,
      CONTENT,
      DATA,
      INSTANCE,
    ]);
  });

  it.each([
    ['', 'no ISCC-UNIT'],
    ['28000100000000', 'nonzero header padding nibble'],
    ['200800' + '00'.repeat(36), 'Length field 8'],
    ['3000000000', 'truncated ISCC-BODY'],
    ['30000000000000', 'trailing byte'],
    ['5005578c7c8fbfbdb58fa88248c53a852c8d05b41f3472493225a522af4a2c9cbf6a', 'ISCC-CODE'],
    ['60100000000000000000', 'MainType 6'],
  ])('rejects %s (%s)', (hex) => {
    expect(() => decodeSeq(Buffer.from(hex, 'hex'))).toThrow();
  });

  it('accepts an unknown SubType', () => {
    expect(decodeSeq(Buffer.from('270000000000', 'hex')).map(unitToString)).toEqual([
      'ISCC:E4AAAAAAAA',
    ]);
  });

  it('accepts an unknown Version without dropping the unit', () => {
    const v1: IsccUnit = {
      maintype: 3,
      subtype: 0,
      version: 1,
      length: 1,
      body: Buffer.alloc(8, 0xab),
    };
    const units = decodeSeq(Buffer.concat([encodeSeq([v1]), encodeSeq([DATA])]));
    expect(units.map((u) => u.version)).toEqual([1, 0]);
  });
});

describe('featureless Image-Codes (IEP-0020 Table 3)', () => {
  it.each([
    ['ISCC:EEDYAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', true],
    ['ISCC:EED74AAAAAAAAAAAVKVKVKVKVKVKVKVKVKVKVKVKVKVKVKVKVKVKVKQ', true],
    ['ISCC:EED76AAAAAAAAAAAVKVKVKVKVKVKVKVKVKVKVKVKVKVKVKVKVKVKVKQ', false],
    ['ISCC:EED2VKVKVKVKVKVKVKVKVKVKVKVKVKVKVKVKVKVKVKAAAAAAAAAAAAA', true],
    ['ISCC:EED2VKVKVKVKVKVKVKVKVKVKVKVKVKVKVKVKVKVKVKVKVKVKVKVKVKQ', false],
  ])('%s featureless: %s', (iscc, expected) => {
    expect(isFeatureless(decodeSeq(encodeSeq([iscc]))[0])).toBe(expected);
  });
});

describe('similarity', () => {
  it('is ⌊100 × (n − d) / n⌋', () => {
    const body = (iscc: string) => decodeSeq(encodeSeq([iscc]))[0].body;
    expect(similarity(body(CONTENT), body(CONTENT))).toBe(100);
    expect(similarity(body(CONTENT), body(flip(CONTENT, 51)))).toBe(80); // 205/256 = 80.08
    expect(similarity(body(CONTENT), body(flip(CONTENT, 52)))).toBe(79); // 204/256 = 79.69
  });
});

describe('decodeBase64', () => {
  it.each([
    VECTOR_BASE64.replace(/=+$/, ''),
    VECTOR_BASE64.replace(/\+/g, '-').replace(/\//g, '_'),
    VECTOR_BASE64.replace(/\+/g, ' '),
    `\n${VECTOR_BASE64}\t`,
  ])('accepts a lenient form', (variant) => {
    expect(decodeBase64(variant).toString('hex')).toBe(VECTOR_HEX);
  });

  it('refuses non-base64 and over-long values', () => {
    expect(() => decodeBase64('not*base64')).toThrow('Value is not valid base64');
    expect(() => decodeBase64('A'.repeat(4097))).toThrow('exceeds 4096');
  });
});

describe('isccMatcher', () => {
  async function seeded() {
    const matcher = isccMatcher();
    await matcher.index('urn:c2pa:original', seq(META, CONTENT, DATA, INSTANCE));
    await matcher.index(
      'urn:c2pa:edited',
      seq(flip(CONTENT, 20), flip(DATA, 60), flip(INSTANCE, 1)),
    );
    await matcher.index('urn:c2pa:meta-only', seq(META, flip(DATA, 200), flip(INSTANCE, 2)));
    return matcher;
  }

  it('scores an Instance-Code match 100 and similar content by its best Content-, Data- or Semantic-Code', async () => {
    const matcher = await seeded();

    const matches = await matcher.match(VECTOR_BASE64, 10);

    expect(matches).toEqual([
      { manifestId: 'urn:c2pa:original', similarityScore: 100 },
      { manifestId: 'urn:c2pa:edited', similarityScore: 92 }, // Content-Code: 236/256
    ]);
  });

  it('caps similarity matches at 99 and ignores Meta-Codes', async () => {
    const matcher = await seeded();

    expect(await matcher.match(seq(META, CONTENT), 10)).toEqual([
      { manifestId: 'urn:c2pa:original', similarityScore: 99 },
      { manifestId: 'urn:c2pa:edited', similarityScore: 92 },
    ]);
    expect(await matcher.match(seq(META, flip(INSTANCE, 9)), 10)).toEqual([]);
  });

  it('applies the threshold and maxResults', async () => {
    const matcher = isccMatcher({ threshold: 95 });
    await matcher.index('a', seq(CONTENT, DATA, INSTANCE));
    await matcher.index('b', seq(flip(CONTENT, 5), flip(DATA, 5), flip(INSTANCE, 5)));
    await matcher.index('c', seq(flip(CONTENT, 20), flip(DATA, 20), flip(INSTANCE, 20)));

    expect(await matcher.match(seq(CONTENT), 10)).toEqual([
      { manifestId: 'a', similarityScore: 99 },
      { manifestId: 'b', similarityScore: 98 },
    ]);
    expect(await matcher.match(seq(CONTENT), 1)).toEqual([
      { manifestId: 'a', similarityScore: 99 },
    ]);
  });

  it('never compares featureless Image-Codes', async () => {
    const featureless = 'ISCC:EEDYAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const matcher = isccMatcher();
    await matcher.index('blank', seq(featureless, DATA, INSTANCE));

    expect(await matcher.match(seq(featureless, flip(INSTANCE, 3)), 10)).toEqual([]);
    await expect(matcher.match(seq(featureless), 10)).rejects.toThrow('holds no 256-bit');
  });

  it('ignores blocks with a non-empty scope and malformed values when indexing', async () => {
    const matcher = isccMatcher();
    await matcher.index('scoped', VECTOR_BASE64, { region: [{ type: 'temporal' }] });
    await matcher.index('broken', Buffer.from('3000000000', 'hex').toString('base64'));
    await matcher.index('whole', VECTOR_BASE64, {});

    expect(await matcher.match(VECTOR_BASE64, 10)).toEqual([
      { manifestId: 'whole', similarityScore: 100 },
    ]);
  });

  it('refuses malformed query values and too many units', async () => {
    const matcher = isccMatcher();
    const many = seq(...Array.from({ length: 33 }, (_, i) => flip(DATA, i + 1)));

    // A truncated 32-bit Data-Code, then a complete one: nothing searchable.
    await expect(matcher.match('MAAAAA==', 10)).rejects.toMatchObject({
      name: 'InvalidSoftBindingValueError',
      message: 'ISCC-BODY is truncated',
    });
    await expect(matcher.match('MAAAAAAA', 10)).rejects.toThrow('holds no 256-bit');
    await expect(matcher.match(seq(META), 10)).rejects.toThrow('holds no 256-bit');
    await expect(matcher.match(many, 10)).rejects.toThrow('more than 32');
    await expect(matcher.index('m', many)).rejects.toThrow('more than 32');
  });

  it('forgets removed manifests', async () => {
    const matcher = await seeded();
    await matcher.remove('urn:c2pa:original');

    expect((await matcher.match(VECTOR_BASE64, 10)).map((m) => m.manifestId)).toEqual([
      'urn:c2pa:edited',
    ]);
  });
});

describe('isccExtractor', () => {
  it('generates the same Text-, Data- and Instance-Codes as iscc-core for text', async () => {
    expect(await isccExtractor(Buffer.from(TEXT), 'text/plain')).toBe(TEXT_SEQ_BASE64);
  });

  it('generates Data- and Instance-Codes only for other media', async () => {
    const value = await isccExtractor(Buffer.from(TEXT), 'image/png');
    expect(decodeSeq(Buffer.from(value!, 'base64')).map((u) => u.maintype)).toEqual([3, 4]);
  });

  it('finds the manifest of the same text through the matcher', async () => {
    const matcher = isccMatcher();
    await matcher.index('urn:c2pa:text', TEXT_SEQ_BASE64);

    const value = await isccExtractor(Buffer.from(`${TEXT} Edited.`), 'text/plain');

    const [match] = await matcher.match(value!, 10);
    expect(match.manifestId).toBe('urn:c2pa:text');
    expect(match.similarityScore).toBeGreaterThanOrEqual(80);
    expect(match.similarityScore).toBeLessThan(100);
  });
});

describe('createMemoryUnitStore', () => {
  it('stores each unit of a manifest once', async () => {
    const store = createMemoryUnitStore();
    const unit = { key: '3-0-0', body: Buffer.alloc(32, 1) };
    await store.add('m', [unit, unit]);
    await store.add('m', [unit]);

    expect(await store.byKey('3-0-0')).toEqual([{ manifestId: 'm', body: unit.body }]);
  });
});

describe('createMongoUnitStore', () => {
  function fakeCollection() {
    const docs: UnitDocument[] = [];
    const indexes: unknown[] = [];
    const same = (a: UnitDocument, b: UnitDocument) =>
      a.manifestId === b.manifestId && a.key === b.key && a.body.equals(b.body);
    const collection: UnitCollection = {
      async createIndex(spec) {
        indexes.push(spec);
      },
      async updateOne(filter, update) {
        if (!docs.some((d) => same(d, filter))) docs.push(update.$setOnInsert);
      },
      async deleteMany({ manifestId }) {
        for (let i = docs.length - 1; i >= 0; i--)
          if (docs[i].manifestId === manifestId) docs.splice(i, 1);
      },
      find({ key }) {
        // The driver returns BSON Binary values, with the bytes in `.buffer`.
        const rows = docs
          .filter((d) => d.key === key)
          .map((d) => ({ manifestId: d.manifestId, body: { buffer: new Uint8Array(d.body) } }));
        return { toArray: async () => rows };
      },
    };
    return { collection, docs, indexes };
  }

  it('upserts units, reads BSON binaries back as buffers and creates its indexes once', async () => {
    const { collection, docs, indexes } = fakeCollection();
    const matcher = isccMatcher({ store: createMongoUnitStore(collection) });

    await matcher.index('urn:c2pa:a', VECTOR_BASE64);
    await matcher.index('urn:c2pa:a', VECTOR_BASE64);

    expect(docs).toHaveLength(3); // Content, Data, Instance; Meta isn't searchable
    expect(indexes).toHaveLength(2);
    expect(await matcher.match(VECTOR_BASE64, 10)).toEqual([
      { manifestId: 'urn:c2pa:a', similarityScore: 100 },
    ]);

    await matcher.remove('urn:c2pa:a');
    expect(docs).toHaveLength(0);
  });
});
