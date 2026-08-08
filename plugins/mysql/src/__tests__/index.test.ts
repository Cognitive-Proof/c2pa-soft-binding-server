import type { Receipt } from '@cognitiveproof/softbinding-api-plugin-types';

const poolQueryMock = jest.fn((..._args: unknown[]): Promise<[unknown, unknown]> =>
  Promise.resolve([[] as unknown[], undefined]),
);
const connQueryMock = jest.fn((..._args: unknown[]): Promise<[unknown, unknown]> =>
  Promise.resolve([[] as unknown[], undefined]),
);
const releaseMock = jest.fn();
const beginTransactionMock = jest.fn(() => Promise.resolve());
const commitMock = jest.fn(() => Promise.resolve());
const rollbackMock = jest.fn(() => Promise.resolve());

const connection = {
  query: connQueryMock,
  beginTransaction: beginTransactionMock,
  commit: commitMock,
  rollback: rollbackMock,
  release: releaseMock,
};

const getConnectionMock = jest.fn(() => Promise.resolve(connection));

const createPoolMock = jest.fn().mockReturnValue({
  query: poolQueryMock,
  getConnection: getConnectionMock,
});

jest.mock('mysql2/promise', () => ({
  __esModule: true,
  default: { createPool: createPoolMock },
}));

import mysqlDataStore from '../index';

describe('mysqlDataStore', () => {
  beforeEach(() => {
    poolQueryMock.mockClear();
    connQueryMock.mockClear();
    releaseMock.mockClear();
    beginTransactionMock.mockClear();
    commitMock.mockClear();
    rollbackMock.mockClear();
  });

  it('addManifest inserts a manifest and returns a urn:c2pa: id', async () => {
    poolQueryMock.mockResolvedValueOnce([{ affectedRows: 1 }, undefined]);

    const data = Buffer.from('manifest-bytes');
    const manifestId = await mysqlDataStore.addManifest(data, 'application/c2pa');

    expect(manifestId).toMatch(/^urn:c2pa:/);
    expect(poolQueryMock).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO manifests'), [
      manifestId,
      data,
      'application/c2pa',
    ]);
  });

  it('addManifest stores under an explicitly supplied manifestId', async () => {
    poolQueryMock.mockResolvedValueOnce([{ affectedRows: 1 }, undefined]);

    const data = Buffer.from('manifest-bytes');
    const manifestId = await mysqlDataStore.addManifest(
      data,
      'application/c2pa',
      'urn:c2pa:explicit-id',
    );

    expect(manifestId).toBe('urn:c2pa:explicit-id');
    expect(poolQueryMock).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO manifests'), [
      'urn:c2pa:explicit-id',
      data,
      'application/c2pa',
    ]);
  });

  it('getManifest returns the manifest entry when found', async () => {
    poolQueryMock.mockResolvedValueOnce([
      [{ data: Buffer.from('abc'), content_type: 'application/c2pa', receipt: null }],
      undefined,
    ]);

    const entry = await mysqlDataStore.getManifest('urn:c2pa:1');

    expect(entry).toEqual({
      data: Buffer.from('abc'),
      contentType: 'application/c2pa',
      receipt: null,
    });
  });

  it('getManifest returns null when not found', async () => {
    poolQueryMock.mockResolvedValueOnce([[], undefined]);
    expect(await mysqlDataStore.getManifest('urn:c2pa:missing')).toBeNull();
  });

  it('manifestExists reflects row presence', async () => {
    poolQueryMock.mockResolvedValueOnce([[{ '1': 1 }], undefined]);
    expect(await mysqlDataStore.manifestExists('urn:c2pa:1')).toBe(true);

    poolQueryMock.mockResolvedValueOnce([[], undefined]);
    expect(await mysqlDataStore.manifestExists('urn:c2pa:missing')).toBe(false);
  });

  it('deleteManifest reflects affectedRows', async () => {
    poolQueryMock.mockResolvedValueOnce([{ affectedRows: 1 }, undefined]);
    expect(await mysqlDataStore.deleteManifest('urn:c2pa:1')).toBe(true);

    poolQueryMock.mockResolvedValueOnce([{ affectedRows: 0 }, undefined]);
    expect(await mysqlDataStore.deleteManifest('urn:c2pa:missing')).toBe(false);
  });

  it('createBinding returns false when the manifest does not exist', async () => {
    poolQueryMock.mockResolvedValueOnce([[], undefined]);

    expect(await mysqlDataStore.createBinding('binding-1', 'urn:c2pa:missing')).toBe(false);
    expect(poolQueryMock).toHaveBeenCalledTimes(1);
  });

  it('createBinding inserts a binding when the manifest exists', async () => {
    poolQueryMock
      .mockResolvedValueOnce([[{ '1': 1 }], undefined])
      .mockResolvedValueOnce([{ affectedRows: 1 }, undefined]);

    expect(await mysqlDataStore.createBinding('binding-1', 'urn:c2pa:1')).toBe(true);
    expect(poolQueryMock).toHaveBeenLastCalledWith(
      expect.stringContaining('INSERT IGNORE INTO bindings'),
      ['binding-1', 'urn:c2pa:1'],
    );
  });

  it('updateBinding replaces all associations within a transaction (PUT semantics)', async () => {
    connQueryMock
      .mockResolvedValueOnce([[{ '1': 1 }], undefined]) // binding exists
      .mockResolvedValueOnce([[{ '1': 1 }], undefined]) // manifest exists
      .mockResolvedValueOnce([{ affectedRows: 1 }, undefined]) // delete
      .mockResolvedValueOnce([{ affectedRows: 1 }, undefined]); // insert

    const result = await mysqlDataStore.updateBinding('binding-1', 'urn:c2pa:2');

    expect(result).toBe(true);
    expect(beginTransactionMock).toHaveBeenCalled();
    expect(commitMock).toHaveBeenCalled();
    expect(releaseMock).toHaveBeenCalled();
  });

  it('updateBinding rolls back and returns false when the binding does not exist', async () => {
    connQueryMock.mockResolvedValueOnce([[], undefined]); // binding doesn't exist

    const result = await mysqlDataStore.updateBinding('no-such-binding', 'urn:c2pa:2');

    expect(result).toBe(false);
    expect(rollbackMock).toHaveBeenCalled();
    expect(releaseMock).toHaveBeenCalled();
  });

  it('updateBinding rolls back and returns false when the target manifest does not exist', async () => {
    connQueryMock
      .mockResolvedValueOnce([[{ '1': 1 }], undefined]) // binding exists
      .mockResolvedValueOnce([[], undefined]); // manifest doesn't exist

    const result = await mysqlDataStore.updateBinding('binding-1', 'urn:c2pa:missing');

    expect(result).toBe(false);
    expect(rollbackMock).toHaveBeenCalled();
    expect(releaseMock).toHaveBeenCalled();
  });

  it('findByBinding maps rows to matches', async () => {
    poolQueryMock.mockResolvedValueOnce([
      [{ manifest_id: 'urn:c2pa:1' }, { manifest_id: 'urn:c2pa:2' }],
      undefined,
    ]);

    const matches = await mysqlDataStore.findByBinding('binding-1');

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

    poolQueryMock.mockResolvedValueOnce([{ affectedRows: 1 }, undefined]);
    expect(await mysqlDataStore.setReceipt('urn:c2pa:1', receipt)).toBe(true);
    expect(poolQueryMock).toHaveBeenLastCalledWith(expect.stringContaining('UPDATE manifests'), [
      JSON.stringify(receipt),
      'urn:c2pa:1',
    ]);

    poolQueryMock.mockResolvedValueOnce([[{ receipt: JSON.stringify(receipt) }], undefined]);
    expect(await mysqlDataStore.getReceipt('urn:c2pa:1')).toEqual(receipt);
  });

  it('getReceipt returns null when there is no receipt', async () => {
    poolQueryMock.mockResolvedValueOnce([[{ receipt: null }], undefined]);
    expect(await mysqlDataStore.getReceipt('urn:c2pa:1')).toBeNull();
  });
});
