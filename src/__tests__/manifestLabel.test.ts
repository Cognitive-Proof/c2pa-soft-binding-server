import { readActiveManifestLabel } from '../utils/manifestLabel';

const C2PA = '6332706100110010800000aa00389b71';
const C2MA = '63326d6100110010800000aa00389b71';
const C2AS = '6332617300110010800000aa00389b71'; // assertion store

function box(type: string, payload: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + payload.length, 0);
  header.write(type, 4, 'latin1');
  return Buffer.concat([header, payload]);
}

function superbox(typeUuid: string, label: string | undefined, children: Buffer[] = []): Buffer {
  const toggles = Buffer.from([label === undefined ? 0x01 : 0x03]);
  const labelBytes = label === undefined ? Buffer.alloc(0) : Buffer.from(`${label}\0`, 'utf8');
  const jumd = box('jumd', Buffer.concat([Buffer.from(typeUuid, 'hex'), toggles, labelBytes]));
  return box('jumb', Buffer.concat([jumd, ...children]));
}

describe('readActiveManifestLabel', () => {
  it('returns the label of the last manifest in the store', () => {
    const store = superbox(C2PA, 'c2pa', [
      superbox(C2MA, 'urn:c2pa:11111111-1111-1111-1111-111111111111', [
        superbox(C2AS, 'c2pa.assertions'),
      ]),
      superbox(C2MA, 'urn:c2pa:22222222-2222-2222-2222-222222222222'),
    ]);

    expect(readActiveManifestLabel(store)).toBe('urn:c2pa:22222222-2222-2222-2222-222222222222');
  });

  it('ignores non-manifest children', () => {
    const store = superbox(C2PA, 'c2pa', [
      superbox(C2MA, 'urn:c2pa:11111111-1111-1111-1111-111111111111'),
      superbox(C2AS, 'something-else'),
    ]);

    expect(readActiveManifestLabel(store)).toBe('urn:c2pa:11111111-1111-1111-1111-111111111111');
  });

  it('throws for bytes that are not JUMBF', () => {
    expect(() => readActiveManifestLabel(Buffer.from('not a manifest store'))).toThrow();
  });

  it('throws for a JUMBF superbox that is not a C2PA store', () => {
    expect(() => readActiveManifestLabel(superbox(C2MA, 'urn:c2pa:x'))).toThrow(
      'Not a C2PA Manifest Store',
    );
  });

  it('throws for a store with no manifests', () => {
    expect(() => readActiveManifestLabel(superbox(C2PA, 'c2pa'))).toThrow(/No manifest/);
  });

  it('throws for a truncated box', () => {
    const store = superbox(C2PA, 'c2pa', [superbox(C2MA, 'urn:c2pa:x')]);
    expect(() => readActiveManifestLabel(store.subarray(0, store.length - 4))).toThrow();
  });
});
