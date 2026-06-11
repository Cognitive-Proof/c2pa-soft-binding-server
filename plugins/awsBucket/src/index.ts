import type { Readable } from 'stream';
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { LoadedData, ObjectStorePlugin } from '@cognitiveproof/softbinding-api-plugin-types';
import { buckets, s3 } from './client';
import { env } from './env';

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function isNotFound(error: unknown): boolean {
  const err = error as Error & { name?: string; $metadata?: { httpStatusCode?: number } };
  return (
    err.name === 'NoSuchKey' || err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404
  );
}

async function objectExists(key: string, bucket: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

async function saveObject(
  key: string,
  data: Buffer,
  bucket: string,
  contentType = 'application/octet-stream',
): Promise<boolean> {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: data,
      ContentType: contentType,
    }),
  );

  return true;
}

async function loadObject(key: string, bucket: string): Promise<LoadedData | null> {
  if (!key) return null;

  try {
    const result = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const buffer = await streamToBuffer(result.Body as Readable);

    return {
      buffer,
      contentType: result.ContentType,
    };
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

async function createObjectLink(
  key: string,
  bucket: string,
  expires = new Date(Date.now() + 60 * 60 * 1000),
): Promise<string | null> {
  if (!key) return null;

  if (!(await objectExists(key, bucket))) {
    console.warn(`Object "${key}" does not exist in bucket "${bucket}".`);
    return null;
  }

  try {
    const expiresInSeconds = Math.max(1, Math.floor((expires.getTime() - Date.now()) / 1000));
    return await getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), {
      expiresIn: expiresInSeconds,
    });
  } catch (error) {
    console.error(`Error creating signed URL for "${key}":`, error);
    return null;
  }
}

async function deleteObject(key: string, bucket: string): Promise<boolean> {
  if (!key) return false;

  try {
    if (!(await objectExists(key, bucket))) {
      console.warn(`Object "${key}" does not exist in bucket "${bucket}".`);
      return false;
    }

    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (error) {
    console.error(`Error deleting "${key}" from "${bucket}":`, error);
    return false;
  }
}

async function deleteObjectsOlderThan(
  bucket: string,
  maxAgeMs = 24 * 60 * 60 * 1000,
): Promise<{ deletedCount: number; deletedKeys: string[] }> {
  const cutoff = Date.now() - maxAgeMs;
  const keysToDelete: string[] = [];
  let continuationToken: string | undefined;

  do {
    const result = await s3.send(
      new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: continuationToken }),
    );

    for (const object of result.Contents ?? []) {
      if (object.Key && object.LastModified && object.LastModified.getTime() < cutoff) {
        keysToDelete.push(object.Key);
      }
    }

    continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
  } while (continuationToken);

  for (let i = 0; i < keysToDelete.length; i += 1000) {
    const batch = keysToDelete.slice(i, i + 1000);

    try {
      await s3.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: batch.map((Key) => ({ Key })) },
        }),
      );
    } catch (error) {
      console.error(`Failed to delete batch from "${bucket}"`, error);
    }
  }

  return {
    deletedCount: keysToDelete.length,
    deletedKeys: keysToDelete,
  };
}

async function getPublicUrl(key: string): Promise<string | null> {
  if (!key) return null;

  if (!(await objectExists(key, buckets.public))) {
    console.warn(`Object "${key}" does not exist in public bucket "${buckets.public}".`);
    return null;
  }

  if (env.AWS_S3_ENDPOINT) {
    const base = env.AWS_S3_ENDPOINT.replace(/\/$/, '');
    return env.AWS_S3_FORCE_PATH_STYLE ? `${base}/${buckets.public}/${key}` : `${base}/${key}`;
  }

  return `https://${buckets.public}.s3.${env.AWS_REGION}.amazonaws.com/${key}`;
}

const awsBucketObjectStore: ObjectStorePlugin = {
  saveData: (key, data, contentType) => saveObject(key, data, buckets.data, contentType),
  loadData: (key) => loadObject(key, buckets.data),
  createDataLink: (key, expires) => createObjectLink(key, buckets.data, expires),
  deleteData: (key) => deleteObject(key, buckets.data),
  deleteDataOlderThan: (maxAgeMs) => deleteObjectsOlderThan(buckets.data, maxAgeMs),
  savePublicData: (key, data, contentType) => saveObject(key, data, buckets.public, contentType),
  loadPublicData: (key) => loadObject(key, buckets.public),
  getPublicUrl,
  deletePublicData: (key) => deleteObject(key, buckets.public),
};

export default awsBucketObjectStore;
