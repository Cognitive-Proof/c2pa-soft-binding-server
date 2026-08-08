import type { Receipt } from '@cognitiveproof/softbinding-api-plugin-types';

const collectionMock = {
  findOne: jest.fn((..._args: unknown[]): Promise<unknown> => Promise.resolve(null)),
  insertOne: jest.fn((..._args: unknown[]) => Promise.resolve({ acknowledged: true })),
  updateOne: jest.fn((..._args: unknown[]) => Promise.resolve({ acknowledged: true })),
  deleteOne: jest.fn((..._args: unknown[]) => Promise.resolve({ deletedCount: 0 })),
  updateMany: jest.fn((..._args: unknown[]) => Promise.resolve({ acknowledged: true })),
  deleteMany: jest.fn((..._args: unknown[]) => Promise.resolve({ deletedCount: 0 })),
};

const dbMock = { collection: jest.fn(() => collectionMock) };

class MongoClientMock {
  connect() {
    return Promise.resolve(this);
  }
  db() {
    return dbMock;
  }
}

jest.mock('mongodb', () => ({
  MongoClient: MongoClientMock,
}));

import mongoDataStore from '../index';

describe('mongoDataStore', () => {
  beforeEach(() => {
    collectionMock.findOne.mockClear();
    collectionMock.insertOne.mockClear();
    collectionMock.updateOne.mockClear();
    collectionMock.deleteOne.mockClear();
    collectionMock.updateMany.mockClear();
    collectionMock.deleteMany.mockClear();
    collectionMock.findOne.mockResolvedValue(null);
  });

  it('addManifest inserts a base64-encoded manifest doc and returns a urn:c2pa: id', async () => {
    const data = Buffer.from('manifest-bytes');
    const manifestId = await mongoDataStore.addManifest(data, 'application/c2pa');

    expect(manifestId).toMatch(/^urn:c2pa:/);
    expect(collectionMock.insertOne).toHaveBeenCalledWith({
      id: manifestId,
      data: data.toString('base64'),
      contentType: 'application/c2pa',
      receipt: null,
    });
  });

  it('addManifest stores under an explicitly supplied manifestId', async () => {
    const data = Buffer.from('manifest-bytes');
    const manifestId = await mongoDataStore.addManifest(
      data,
      'application/c2pa',
      'urn:c2pa:explicit-id',
    );

    expect(manifestId).toBe('urn:c2pa:explicit-id');
    expect(collectionMock.insertOne).toHaveBeenCalledWith({
      id: 'urn:c2pa:explicit-id',
      data: data.toString('base64'),
      contentType: 'application/c2pa',
      receipt: null,
    });
  });

  it('getManifest returns the decoded manifest entry when found', async () => {
    const data = Buffer.from('abc');
    collectionMock.findOne.mockResolvedValueOnce({
      id: 'urn:c2pa:1',
      data: data.toString('base64'),
      contentType: 'application/c2pa',
      receipt: null,
    });

    const entry = await mongoDataStore.getManifest('urn:c2pa:1');

    expect(entry).toEqual({ data, contentType: 'application/c2pa', receipt: null });
  });

  it('getManifest returns null when not found', async () => {
    expect(await mongoDataStore.getManifest('urn:c2pa:missing')).toBeNull();
  });

  it('manifestExists reflects whether the document exists', async () => {
    collectionMock.findOne.mockResolvedValueOnce({ id: 'urn:c2pa:1' });
    expect(await mongoDataStore.manifestExists('urn:c2pa:1')).toBe(true);

    expect(await mongoDataStore.manifestExists('urn:c2pa:missing')).toBe(false);
  });

  it('deleteManifest cascades to bindings and returns true when deleted', async () => {
    collectionMock.deleteOne.mockResolvedValueOnce({ deletedCount: 1 });

    expect(await mongoDataStore.deleteManifest('urn:c2pa:1')).toBe(true);
    expect(collectionMock.updateMany).toHaveBeenCalledWith(
      {},
      { $pull: { manifestIds: 'urn:c2pa:1' } },
    );
    expect(collectionMock.deleteMany).toHaveBeenCalledWith({ manifestIds: { $size: 0 } });
  });

  it('deleteManifest returns false when nothing was deleted', async () => {
    collectionMock.deleteOne.mockResolvedValueOnce({ deletedCount: 0 });

    expect(await mongoDataStore.deleteManifest('urn:c2pa:missing')).toBe(false);
    expect(collectionMock.updateMany).not.toHaveBeenCalled();
  });

  it('createBinding returns false when the manifest does not exist', async () => {
    expect(await mongoDataStore.createBinding('binding-1', 'urn:c2pa:missing')).toBe(false);
    expect(collectionMock.updateOne).not.toHaveBeenCalled();
  });

  it('createBinding upserts the binding when the manifest exists', async () => {
    collectionMock.findOne.mockResolvedValueOnce({ id: 'urn:c2pa:1' });

    expect(await mongoDataStore.createBinding('binding-1', 'urn:c2pa:1')).toBe(true);
    expect(collectionMock.updateOne).toHaveBeenCalledWith(
      { id: 'binding-1' },
      { $addToSet: { manifestIds: 'urn:c2pa:1' } },
      { upsert: true },
    );
  });

  it('updateBinding replaces all associations (PUT semantics)', async () => {
    collectionMock.findOne
      .mockResolvedValueOnce({ id: 'binding-1', manifestIds: ['urn:c2pa:1'] }) // binding doc
      .mockResolvedValueOnce({ id: 'urn:c2pa:2' }); // manifest exists

    expect(await mongoDataStore.updateBinding('binding-1', 'urn:c2pa:2')).toBe(true);
    expect(collectionMock.updateOne).toHaveBeenCalledWith(
      { id: 'binding-1' },
      { $set: { manifestIds: ['urn:c2pa:2'] } },
      { upsert: false },
    );
  });

  it('updateBinding returns false for an unknown binding', async () => {
    expect(await mongoDataStore.updateBinding('no-such-binding', 'urn:c2pa:1')).toBe(false);
    expect(collectionMock.updateOne).not.toHaveBeenCalled();
  });

  it('updateBinding returns false when the target manifest does not exist', async () => {
    collectionMock.findOne
      .mockResolvedValueOnce({ id: 'binding-1', manifestIds: ['urn:c2pa:1'] }) // binding doc
      .mockResolvedValueOnce(null); // manifest does not exist

    expect(await mongoDataStore.updateBinding('binding-1', 'urn:c2pa:missing')).toBe(false);
    expect(collectionMock.updateOne).not.toHaveBeenCalled();
  });

  it('findByBinding returns matches up to maxResults', async () => {
    collectionMock.findOne.mockResolvedValueOnce({
      id: 'binding-1',
      manifestIds: ['urn:c2pa:1', 'urn:c2pa:2', 'urn:c2pa:3'],
    });

    const matches = await mongoDataStore.findByBinding('binding-1', 2);

    expect(matches).toEqual([
      { manifestId: 'urn:c2pa:1', similarityScore: 100 },
      { manifestId: 'urn:c2pa:2', similarityScore: 100 },
    ]);
  });

  it('findByBinding returns an empty array for an unknown binding', async () => {
    expect(await mongoDataStore.findByBinding('no-such-binding')).toEqual([]);
  });

  it('setReceipt and getReceipt round-trip a receipt', async () => {
    const receipt: Receipt = {
      '@context': { c2pa: 'https://c2pa.org', receipt: 'https://c2pa.org/receipt' },
      '@type': 'Receipt',
      repository: { uri: 'https://example.com', manifestId: 'urn:c2pa:1' },
      anchor: { uri: 'https://example.com/anchor', proof: { alg: 'hmac-sha256', value: 'abc' } },
    };

    collectionMock.findOne.mockResolvedValueOnce({ id: 'urn:c2pa:1' });
    expect(await mongoDataStore.setReceipt('urn:c2pa:1', receipt)).toBe(true);
    expect(collectionMock.updateOne).toHaveBeenCalledWith(
      { id: 'urn:c2pa:1' },
      { $set: { receipt } },
      { upsert: false },
    );

    collectionMock.findOne.mockResolvedValueOnce({ id: 'urn:c2pa:1', receipt });
    expect(await mongoDataStore.getReceipt('urn:c2pa:1')).toEqual(receipt);
  });

  it('setReceipt returns false for an unknown manifest', async () => {
    expect(await mongoDataStore.setReceipt('urn:c2pa:missing', {} as Receipt)).toBe(false);
    expect(collectionMock.updateOne).not.toHaveBeenCalled();
  });

  it('getReceipt returns null when there is no receipt', async () => {
    collectionMock.findOne.mockResolvedValueOnce({ id: 'urn:c2pa:1', receipt: null });
    expect(await mongoDataStore.getReceipt('urn:c2pa:1')).toBeNull();
  });
});
