const mockSend = jest.fn();
const mockGetSignedUrl = jest.fn();

class MockCommand {
  constructor(public input: Record<string, unknown>) {}
}

class PutObjectCommand extends MockCommand {}
class GetObjectCommand extends MockCommand {}
class HeadObjectCommand extends MockCommand {}
class DeleteObjectCommand extends MockCommand {}
class DeleteObjectsCommand extends MockCommand {}
class ListObjectsV2Command extends MockCommand {}

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send: mockSend })),
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
}));

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: mockGetSignedUrl,
}));

import awsBucketObjectStore from '../index';

function notFoundError(): Error & { name: string } {
  const err = new Error('Not Found') as Error & { name: string };
  err.name = 'NotFound';
  return err;
}

function asyncIterableFrom(chunks: Buffer[]): AsyncIterable<Buffer> {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const chunk of chunks) yield chunk;
    },
  };
}

describe('awsBucketObjectStore', () => {
  beforeEach(() => {
    mockSend.mockReset();
    mockGetSignedUrl.mockReset();
  });

  it('saveData puts an object into the data bucket', async () => {
    mockSend.mockResolvedValueOnce({});

    const result = await awsBucketObjectStore.saveData('key1', Buffer.from('hello'), 'text/plain');

    expect(result).toBe(true);
    const command = mockSend.mock.calls[0][0] as PutObjectCommand;
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input).toEqual({
      Bucket: 'data-bucket',
      Key: 'key1',
      Body: Buffer.from('hello'),
      ContentType: 'text/plain',
    });
  });

  it('loadData returns the buffer and content type for an existing object', async () => {
    mockSend.mockResolvedValueOnce({
      Body: asyncIterableFrom([Buffer.from('hel'), Buffer.from('lo')]),
      ContentType: 'text/plain',
    });

    const result = await awsBucketObjectStore.loadData('key1');

    expect(result).toEqual({ buffer: Buffer.from('hello'), contentType: 'text/plain' });
    const command = mockSend.mock.calls[0][0] as GetObjectCommand;
    expect(command).toBeInstanceOf(GetObjectCommand);
    expect(command.input).toEqual({ Bucket: 'data-bucket', Key: 'key1' });
  });

  it('loadData returns null for an empty key', async () => {
    expect(await awsBucketObjectStore.loadData('')).toBeNull();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('loadData returns null when the object is not found', async () => {
    mockSend.mockRejectedValueOnce(notFoundError());

    expect(await awsBucketObjectStore.loadData('missing-key')).toBeNull();
  });

  it('loadData rethrows unexpected errors', async () => {
    mockSend.mockRejectedValueOnce(new Error('boom'));

    await expect(awsBucketObjectStore.loadData('key1')).rejects.toThrow('boom');
  });

  it('createDataLink returns a signed url for an existing object', async () => {
    mockSend.mockResolvedValueOnce({}); // HeadObjectCommand succeeds (object exists)
    mockGetSignedUrl.mockResolvedValueOnce('https://signed.example.com/key1');

    const url = await awsBucketObjectStore.createDataLink('key1');

    expect(url).toBe('https://signed.example.com/key1');
    expect(mockSend.mock.calls[0][0]).toBeInstanceOf(HeadObjectCommand);
    expect(mockGetSignedUrl).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(GetObjectCommand),
      expect.objectContaining({ expiresIn: expect.any(Number) }),
    );
  });

  it('createDataLink returns null when the object does not exist', async () => {
    mockSend.mockRejectedValueOnce(notFoundError());

    expect(await awsBucketObjectStore.createDataLink('missing-key')).toBeNull();
    expect(mockGetSignedUrl).not.toHaveBeenCalled();
  });

  it('deleteData deletes an existing object and returns true', async () => {
    mockSend.mockResolvedValueOnce({}); // HeadObjectCommand: exists
    mockSend.mockResolvedValueOnce({}); // DeleteObjectCommand

    expect(await awsBucketObjectStore.deleteData('key1')).toBe(true);
    expect(mockSend.mock.calls[1][0]).toBeInstanceOf(DeleteObjectCommand);
  });

  it('deleteData returns false when the object does not exist', async () => {
    mockSend.mockRejectedValueOnce(notFoundError());

    expect(await awsBucketObjectStore.deleteData('missing-key')).toBe(false);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('deleteDataOlderThan deletes only objects older than the cutoff', async () => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    mockSend.mockResolvedValueOnce({
      Contents: [
        { Key: 'old.bin', LastModified: new Date(cutoff - 1000) },
        { Key: 'new.bin', LastModified: new Date() },
      ],
      IsTruncated: false,
    });
    mockSend.mockResolvedValueOnce({});

    const result = await awsBucketObjectStore.deleteDataOlderThan(24 * 60 * 60 * 1000);

    expect(result).toEqual({ deletedCount: 1, deletedKeys: ['old.bin'] });
    expect(mockSend.mock.calls[0][0]).toBeInstanceOf(ListObjectsV2Command);
    const deleteCommand = mockSend.mock.calls[1][0] as DeleteObjectsCommand;
    expect(deleteCommand).toBeInstanceOf(DeleteObjectsCommand);
    expect(deleteCommand.input).toEqual({
      Bucket: 'data-bucket',
      Delete: { Objects: [{ Key: 'old.bin' }] },
    });
  });

  it('savePublicData puts an object into the public bucket', async () => {
    mockSend.mockResolvedValueOnce({});

    await awsBucketObjectStore.savePublicData('pub-key', Buffer.from('hi'), 'text/plain');

    const command = mockSend.mock.calls[0][0] as PutObjectCommand;
    expect(command.input).toMatchObject({ Bucket: 'public-bucket', Key: 'pub-key' });
  });

  it('loadPublicData reads an object from the public bucket', async () => {
    mockSend.mockResolvedValueOnce({
      Body: asyncIterableFrom([Buffer.from('pub')]),
      ContentType: 'text/plain',
    });

    const result = await awsBucketObjectStore.loadPublicData('pub-key');

    expect(result).toEqual({ buffer: Buffer.from('pub'), contentType: 'text/plain' });
    const command = mockSend.mock.calls[0][0] as GetObjectCommand;
    expect(command.input).toEqual({ Bucket: 'public-bucket', Key: 'pub-key' });
  });

  it('getPublicUrl returns a public S3 URL for an existing object', async () => {
    mockSend.mockResolvedValueOnce({}); // HeadObjectCommand: exists

    const url = await awsBucketObjectStore.getPublicUrl('pub-key');

    expect(url).toBe('https://public-bucket.s3.us-east-1.amazonaws.com/pub-key');
  });

  it('getPublicUrl returns null when the object does not exist', async () => {
    mockSend.mockRejectedValueOnce(notFoundError());

    expect(await awsBucketObjectStore.getPublicUrl('missing-key')).toBeNull();
  });

  it('deletePublicData deletes from the public bucket', async () => {
    mockSend.mockResolvedValueOnce({}); // HeadObjectCommand: exists
    mockSend.mockResolvedValueOnce({}); // DeleteObjectCommand

    expect(await awsBucketObjectStore.deletePublicData('pub-key')).toBe(true);
    const command = mockSend.mock.calls[1][0] as DeleteObjectCommand;
    expect(command.input).toEqual({ Bucket: 'public-bucket', Key: 'pub-key' });
  });
});
