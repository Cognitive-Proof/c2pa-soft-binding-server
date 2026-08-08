import type { Receipt } from '@cognitiveproof/softbinding-api-plugin-types';

const queryMock = jest.fn((..._args: unknown[]) =>
  Promise.resolve({ rows: [] as unknown[], rowCount: 0 }),
);
const clientQueryMock = jest.fn(
  (..._args: unknown[]): Promise<{ rows: unknown[]; rowCount: number } | undefined> =>
    Promise.resolve({ rows: [], rowCount: 0 }),
);
const releaseMock = jest.fn();
const connectMock = jest.fn(() =>
  Promise.resolve({ query: clientQueryMock, release: releaseMock }),
);

const PoolMock = jest.fn().mockImplementation(() => ({
  query: queryMock,
  connect: connectMock,
}));

jest.mock('pg', () => ({
  Pool: PoolMock,
}));

import postgresDataStore from '../index';

describe('postgresDataStore', () => {
  beforeEach(() => {
    queryMock.mockClear();
    clientQueryMock.mockClear();
    connectMock.mockClear();
    releaseMock.mockClear();
  });

  it('addManifest inserts a manifest and returns a urn:c2pa: id', async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const data = Buffer.from('manifest-bytes');
    const manifestId = await postgresDataStore.addManifest(data, 'application/c2pa');

    expect(manifestId).toMatch(/^urn:c2pa:/);
    expect(queryMock).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO manifests'), [
      manifestId,
      data,
      'application/c2pa',
    ]);
  });

  it('addManifest stores under an explicitly supplied manifestId', async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const data = Buffer.from('manifest-bytes');
    const manifestId = await postgresDataStore.addManifest(
      data,
      'application/c2pa',
      'urn:c2pa:explicit-id',
    );

    expect(manifestId).toBe('urn:c2pa:explicit-id');
    expect(queryMock).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO manifests'), [
      'urn:c2pa:explicit-id',
      data,
      'application/c2pa',
    ]);
  });

  it('getManifest returns the manifest entry when found', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ data: Buffer.from('abc'), content_type: 'application/c2pa', receipt: null }],
      rowCount: 1,
    });

    const entry = await postgresDataStore.getManifest('urn:c2pa:1');

    expect(entry).toEqual({
      data: Buffer.from('abc'),
      contentType: 'application/c2pa',
      receipt: null,
    });
  });

  it('getManifest returns null when not found', async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    expect(await postgresDataStore.getManifest('urn:c2pa:missing')).toBeNull();
  });

  it('manifestExists reflects rowCount', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ '?column?': 1 }], rowCount: 1 });
    expect(await postgresDataStore.manifestExists('urn:c2pa:1')).toBe(true);

    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    expect(await postgresDataStore.manifestExists('urn:c2pa:missing')).toBe(false);
  });

  it('deleteManifest reflects rowCount', async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    expect(await postgresDataStore.deleteManifest('urn:c2pa:1')).toBe(true);

    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    expect(await postgresDataStore.deleteManifest('urn:c2pa:missing')).toBe(false);
  });

  it('createBinding returns false when the manifest does not exist', async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    expect(await postgresDataStore.createBinding('binding-1', 'urn:c2pa:missing')).toBe(false);
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it('createBinding inserts a binding when the manifest exists', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    expect(await postgresDataStore.createBinding('binding-1', 'urn:c2pa:1')).toBe(true);
    expect(queryMock).toHaveBeenLastCalledWith(expect.stringContaining('INSERT INTO bindings'), [
      'binding-1',
      'urn:c2pa:1',
    ]);
  });

  it('updateBinding replaces all associations within a transaction (PUT semantics)', async () => {
    clientQueryMock
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }], rowCount: 1 }) // binding exists
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }], rowCount: 1 }) // manifest exists
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // delete
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // insert
      .mockResolvedValueOnce(undefined); // COMMIT

    const result = await postgresDataStore.updateBinding('binding-1', 'urn:c2pa:2');

    expect(result).toBe(true);
    expect(clientQueryMock).toHaveBeenNthCalledWith(1, 'BEGIN');
    expect(clientQueryMock).toHaveBeenNthCalledWith(6, 'COMMIT');
    expect(releaseMock).toHaveBeenCalled();
  });

  it('updateBinding rolls back and returns false when the binding does not exist', async () => {
    clientQueryMock
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // binding doesn't exist
      .mockResolvedValueOnce(undefined); // ROLLBACK

    const result = await postgresDataStore.updateBinding('no-such-binding', 'urn:c2pa:2');

    expect(result).toBe(false);
    expect(clientQueryMock).toHaveBeenNthCalledWith(3, 'ROLLBACK');
    expect(releaseMock).toHaveBeenCalled();
  });

  it('updateBinding rolls back and returns false when the target manifest does not exist', async () => {
    clientQueryMock
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }], rowCount: 1 }) // binding exists
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // manifest doesn't exist
      .mockResolvedValueOnce(undefined); // ROLLBACK

    const result = await postgresDataStore.updateBinding('binding-1', 'urn:c2pa:missing');

    expect(result).toBe(false);
    expect(clientQueryMock).toHaveBeenNthCalledWith(4, 'ROLLBACK');
    expect(releaseMock).toHaveBeenCalled();
  });

  it('findByBinding maps rows to matches', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ manifest_id: 'urn:c2pa:1' }, { manifest_id: 'urn:c2pa:2' }],
      rowCount: 2,
    });

    const matches = await postgresDataStore.findByBinding('binding-1');

    expect(matches).toEqual([
      { manifestId: 'urn:c2pa:1', similarityScore: 100 },
      { manifestId: 'urn:c2pa:2', similarityScore: 100 },
    ]);
  });

  it('setReceipt and getReceipt round-trip a receipt', async () => {
    const receipt: Receipt = {
      '@context': { c2pa: 'https://c2pa.org', receipt: 'https://c2pa.org/receipt' },
      '@type': 'Receipt',
      repository: { uri: 'https://example.com', manifestId: 'urn:c2pa:1' },
      anchor: { uri: 'https://example.com/anchor', proof: { alg: 'hmac-sha256', value: 'abc' } },
    };

    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    expect(await postgresDataStore.setReceipt('urn:c2pa:1', receipt)).toBe(true);
    expect(queryMock).toHaveBeenLastCalledWith(expect.stringContaining('UPDATE manifests'), [
      JSON.stringify(receipt),
      'urn:c2pa:1',
    ]);

    queryMock.mockResolvedValueOnce({ rows: [{ receipt: JSON.stringify(receipt) }], rowCount: 1 });
    expect(await postgresDataStore.getReceipt('urn:c2pa:1')).toEqual(receipt);
  });

  it('getReceipt returns null when there is no receipt', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ receipt: null }], rowCount: 1 });
    expect(await postgresDataStore.getReceipt('urn:c2pa:1')).toBeNull();
  });
});
