import fs from 'fs';
import path from 'path';
import {
  checkLength,
  checkReport,
  createC2paManifestReader,
  InvalidManifestError,
  softBindings,
  type C2paReport,
} from '../index';

const fixture = (name: string) => fs.readFileSync(path.join(__dirname, 'fixtures', name));
// Signed by a throwaway test CA (test-ca.pem) with one io.iscc.v0 soft binding: IEP-0020 test vector 1.
const SIGNED = fixture('iscc-signed.c2pa');
const TEST_CA = fixture('test-ca.pem').toString('utf8');
const VECTOR_1 =
  'AAdXjHyPv721jyn2Pv6zhxVT+qdf+XRY1J7/XuTd82u2ySAHqIJIxTqFLI1+nFRwR8mjbEBStqyr7x4qTOFeWG4MswUwBwW0HzRySTIl0n7cvbYyNoRq' +
  'U+4o3speNWGswMm734G1QAelIq9KLJy/aoCJJK/SrPoHkzR7k2Z49ZguIv3T3UoONw==';

function report(
  failures: string[],
  successes = ['claimSignature.validated'],
  extra: Partial<C2paReport> = {},
): C2paReport {
  return {
    active_manifest: 'urn:c2pa:test',
    manifests: { 'urn:c2pa:test': { assertions: [] } },
    validation_results: {
      activeManifest: {
        failure: failures.map((code) => ({ code })),
        success: successes.map((code) => ({ code })),
      },
    },
    ...extra,
  };
}

async function refusal(promise: Promise<unknown>): Promise<InvalidManifestError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(InvalidManifestError);
    return err as InvalidManifestError;
  }
  throw new Error('expected a refusal');
}

describe('createC2paManifestReader (c2pa-rs)', () => {
  it('reads the id, the soft binding and trust of a signed sidecar', async () => {
    const info = await createC2paManifestReader({ trustAnchors: TEST_CA })(SIGNED);

    expect(info.manifestId).toMatch(/^urn:c2pa:[0-9a-f-]{36}$/);
    expect(info.bindings).toEqual([{ alg: 'io.iscc.v0', value: VECTOR_1 }]);
    expect(info.trusted).toBe(true);
  });

  it('accepts a credential outside the trust anchors as untrusted', async () => {
    const info = await createC2paManifestReader()(SIGNED);
    expect(info.trusted).toBe(false);
  });

  it('refuses an untrusted credential with requireTrusted', async () => {
    const err = await refusal(createC2paManifestReader({ requireTrusted: true })(SIGNED));
    expect(err.code).toBe('signingCredential.untrusted');
  });

  it('refuses a manifest whose soft binding was changed after signing', async () => {
    const tampered = Buffer.from(SIGNED);
    tampered[tampered.indexOf(Buffer.from(VECTOR_1.slice(8, 24)))] ^= 1;

    const err = await refusal(createC2paManifestReader({ trustAnchors: TEST_CA })(tampered));

    expect(err.code).toBe('assertion.hashedURI.mismatch');
  });

  it('refuses bytes after the Manifest Store', async () => {
    const err = await refusal(
      createC2paManifestReader()(Buffer.concat([SIGNED, Buffer.from('x')])),
    );
    expect(err.code).toBe('manifest.trailingData');
  });

  it('refuses bytes that are not a Manifest Store', async () => {
    const err = await refusal(createC2paManifestReader()(Buffer.from('hello world')));
    expect(err.code).toBe('manifest.unreadable');
  });

  it('reads a c2pa-rs fixture without soft bindings', async () => {
    const info = await createC2paManifestReader()(fixture('manifest-c2pa-rs.c2pa'));

    expect(info).toEqual({
      manifestId: 'contentauth:urn:uuid:b2b1f7fa-b119-4de1-9c0d-c97fbea3f2c3',
      bindings: [],
      trusted: false,
    });
  });

  it('accepts an expired credential as untrusted, offline, and reads its base64 bindings', async () => {
    const info = await createC2paManifestReader()(fixture('cawg-c2pa-rs.c2pa'));

    expect(info.trusted).toBe(false);
    // Its TrustMark value is written as plain text ("2*0001…"), not a byte string, so it's skipped.
    expect(info.bindings.map((b) => b.alg)).toEqual(['com.adobe.icn.dense']);
  });

  it('refuses an expired credential when allowExpired is false', async () => {
    const err = await refusal(
      createC2paManifestReader({ allowExpired: false })(fixture('cawg-c2pa-rs.c2pa')),
    );
    expect(err.code).toBe('signingCredential.expired');
  });
});

describe('checkReport', () => {
  it('tolerates hard-binding and trust failures', () => {
    const info = checkReport(
      report(['assertion.dataHash.mismatch', 'signingCredential.untrusted']),
    );
    expect(info).toEqual({ manifestId: 'urn:c2pa:test', bindings: [], trusted: false });
  });

  it('refuses any other failure with its code', () => {
    expect(() => checkReport(report(['assertion.action.malformed']))).toThrow(
      'assertion.action.malformed: The active manifest failed validation',
    );
  });

  it('refuses an unverified claim signature', () => {
    expect(() => checkReport(report([], []))).toThrow(/^claimSignature\.missing/);
  });

  it('refuses a missing active manifest and unprintable or long ids', () => {
    expect(() => checkReport({ ...report([]), active_manifest: undefined })).toThrow(
      /^manifest\.missing/,
    );
    expect(() => checkReport({ ...report([]), active_manifest: 'urn:\n' })).toThrow(
      /^manifest\.idInvalid/,
    );
    expect(() => checkReport({ ...report([]), active_manifest: 'x'.repeat(256) })).toThrow(
      /^manifest\.idInvalid/,
    );
  });

  it('refuses an ingredient changed after signing but not an untrusted one', () => {
    const delta = (code: string) => ({
      validation_results: {
        ...report([]).validation_results,
        ingredientDeltas: [{ validationDeltas: { failure: [{ code }] } }],
      },
    });

    expect(() => checkReport(report([], undefined, delta('assertion.dataHash.mismatch')))).toThrow(
      /^assertion\.dataHash\.mismatch: An ingredient/,
    );
    expect(() =>
      checkReport(report([], undefined, delta('signingCredential.untrusted'))),
    ).not.toThrow();
  });
});

describe('softBindings', () => {
  it('reads every block of numbered assertions, byte arrays as base64, keeping scopes', () => {
    expect(
      softBindings([
        { label: 'c2pa.soft-binding', data: { alg: 'a', blocks: [{ value: 'AAE=' }] } },
        {
          label: 'c2pa.soft-binding__1',
          data: { alg: 'b', blocks: [{ value: [0, 1], scope: { region: [] } }] },
        },
        { label: 'c2pa.hash.data', data: { alg: 'sha256', blocks: [{ value: 'AAE=' }] } },
      ]),
    ).toEqual([
      { alg: 'a', value: 'AAE=' },
      { alg: 'b', value: 'AAE=', scope: { region: [] } },
    ]);
  });

  it("reads c2pa-rs's b64'…' byte strings", () => {
    expect(
      softBindings([
        { label: 'c2pa.soft-binding', data: { alg: 'a', blocks: [{ value: "b64'AAE='" }] } },
      ]),
    ).toEqual([{ alg: 'a', value: 'AAE=' }]);
  });

  it('skips blocks without an algorithm or a byte-string value', () => {
    expect(
      softBindings([
        { label: 'c2pa.soft-binding', data: { blocks: [{ value: 'AAE=' }] } },
        {
          label: 'c2pa.soft-binding',
          data: {
            alg: 'a',
            blocks: [{ value: 'not base64!' }, { value: "b64'not base64!'" }, { value: [] }, {}],
          },
        },
      ]),
    ).toEqual([]);
  });
});

describe('checkLength', () => {
  it('accepts a 64-bit XLBox that matches the upload', () => {
    const data = Buffer.alloc(20);
    data.writeUInt32BE(1, 0);
    data.writeBigUInt64BE(20n, 8);
    expect(() => checkLength(data)).not.toThrow();
  });

  it('refuses a short upload', () => {
    expect(() => checkLength(Buffer.from([0, 0]))).toThrow(/^manifest\.trailingData/);
  });
});
