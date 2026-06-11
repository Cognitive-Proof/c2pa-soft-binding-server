import type { createBucketMock } from './testSupport/bucketMock';

type BucketMock = ReturnType<typeof createBucketMock>;

jest.mock('@google-cloud/storage', () => {
  const { createBucketMock } = require('./testSupport/bucketMock');
  const bucketMocks: Record<string, unknown> = {};

  class StorageMock {
    bucket(name: string) {
      bucketMocks[name] ??= createBucketMock(name);
      return bucketMocks[name];
    }
  }

  return { Storage: StorageMock, __bucketMocks: bucketMocks };
});

const { __bucketMocks } = jest.requireMock('@google-cloud/storage') as {
  __bucketMocks: Record<string, BucketMock>;
};

import gcpBucketObjectStore from '../index';

const dataBucket = (): BucketMock => __bucketMocks['data-bucket'];
const publicBucket = (): BucketMock => __bucketMocks['public-bucket'];

describe('gcpBucketObjectStore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('saveData writes to the data bucket and resolves true', async () => {
    const result = await gcpBucketObjectStore.saveData('key1', Buffer.from('hello'), 'text/plain');

    expect(result).toBe(true);
    expect(dataBucket().file).toHaveBeenCalledWith('key1');
    expect(dataBucket().fileMock.createWriteStream).toHaveBeenCalledWith({
      resumable: false,
      metadata: { contentType: 'text/plain' },
    });
  });

  it('loadData returns the buffer and content type for an existing object', async () => {
    dataBucket().fileMock.getMetadata.mockResolvedValueOnce([{ contentType: 'text/plain' }]);
    dataBucket().fileMock.download.mockResolvedValueOnce([Buffer.from('hello')]);

    const result = await gcpBucketObjectStore.loadData('key1');

    expect(result).toEqual({ buffer: Buffer.from('hello'), contentType: 'text/plain' });
  });

  it('loadData returns null for an empty key', async () => {
    expect(await gcpBucketObjectStore.loadData('')).toBeNull();
  });

  it('loadData returns null when the object is not found (404)', async () => {
    const error: Error & { code?: number } = new Error('Not Found');
    error.code = 404;
    dataBucket().fileMock.getMetadata.mockRejectedValueOnce(error);

    expect(await gcpBucketObjectStore.loadData('missing-key')).toBeNull();
  });

  it('loadData rethrows unexpected errors', async () => {
    dataBucket().fileMock.getMetadata.mockRejectedValueOnce(new Error('boom'));

    await expect(gcpBucketObjectStore.loadData('key1')).rejects.toThrow('boom');
  });

  it('createDataLink returns a signed url for an existing object', async () => {
    dataBucket().fileMock.exists.mockResolvedValueOnce([true]);
    dataBucket().fileMock.getSignedUrl.mockResolvedValueOnce(['https://signed.example.com/key1']);

    const url = await gcpBucketObjectStore.createDataLink('key1');

    expect(url).toBe('https://signed.example.com/key1');
  });

  it('createDataLink returns null when the object does not exist', async () => {
    dataBucket().fileMock.exists.mockResolvedValueOnce([false]);

    expect(await gcpBucketObjectStore.createDataLink('missing-key')).toBeNull();
  });

  it('deleteData deletes an existing object and returns true', async () => {
    dataBucket().fileMock.exists.mockResolvedValueOnce([true]);

    expect(await gcpBucketObjectStore.deleteData('key1')).toBe(true);
    expect(dataBucket().fileMock.delete).toHaveBeenCalled();
  });

  it('deleteData returns false when the object does not exist', async () => {
    dataBucket().fileMock.exists.mockResolvedValueOnce([false]);

    expect(await gcpBucketObjectStore.deleteData('missing-key')).toBe(false);
    expect(dataBucket().fileMock.delete).not.toHaveBeenCalled();
  });

  it('deleteDataOlderThan deletes only files older than the cutoff', async () => {
    const oldFile = {
      name: 'old.bin',
      metadata: { timeCreated: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString() },
      delete: jest.fn().mockResolvedValue(undefined),
    };
    const newFile = {
      name: 'new.bin',
      metadata: { timeCreated: new Date().toISOString() },
      delete: jest.fn().mockResolvedValue(undefined),
    };
    dataBucket().getFiles.mockResolvedValueOnce([[oldFile, newFile]]);

    const result = await gcpBucketObjectStore.deleteDataOlderThan(24 * 60 * 60 * 1000);

    expect(result).toEqual({ deletedCount: 1, deletedKeys: ['old.bin'] });
    expect(oldFile.delete).toHaveBeenCalled();
    expect(newFile.delete).not.toHaveBeenCalled();
  });

  it('savePublicData writes to the public bucket', async () => {
    await gcpBucketObjectStore.savePublicData('pub-key', Buffer.from('hello'), 'text/plain');

    expect(publicBucket().file).toHaveBeenCalledWith('pub-key');
  });

  it('loadPublicData reads from the public bucket', async () => {
    publicBucket().fileMock.getMetadata.mockResolvedValueOnce([{ contentType: 'text/plain' }]);
    publicBucket().fileMock.download.mockResolvedValueOnce([Buffer.from('pub')]);

    const result = await gcpBucketObjectStore.loadPublicData('pub-key');

    expect(result).toEqual({ buffer: Buffer.from('pub'), contentType: 'text/plain' });
  });

  it('getPublicUrl returns a public URL for an existing object', async () => {
    publicBucket().fileMock.exists.mockResolvedValueOnce([true]);

    const url = await gcpBucketObjectStore.getPublicUrl('pub-key');

    expect(url).toBe('https://storage.googleapis.com/public-bucket/pub-key');
  });

  it('getPublicUrl returns null when the object does not exist', async () => {
    publicBucket().fileMock.exists.mockResolvedValueOnce([false]);

    expect(await gcpBucketObjectStore.getPublicUrl('missing-key')).toBeNull();
  });

  it('deletePublicData deletes from the public bucket', async () => {
    publicBucket().fileMock.exists.mockResolvedValueOnce([true]);

    expect(await gcpBucketObjectStore.deletePublicData('pub-key')).toBe(true);
    expect(publicBucket().fileMock.delete).toHaveBeenCalled();
  });
});
