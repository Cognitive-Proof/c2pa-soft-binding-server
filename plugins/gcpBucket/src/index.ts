import {
  type Bucket,
  type GetSignedUrlConfig,
  Storage,
  type StorageOptions,
} from '@google-cloud/storage';
import type { LoadedData, ObjectStorePlugin } from '@cognitiveproof/softbinding-api-plugin-types';
import { env } from './env';

const storageOptions: StorageOptions | undefined = env.GOOGLE_BUCKET_CREDENTIAL
  ? {
      // GOOGLE_BUCKET_CREDENTIAL is a JSON string containing service account
      // credentials. If unset, Application Default Credentials are used.
      credentials: env.GOOGLE_BUCKET_CREDENTIAL as StorageOptions['credentials'],
    }
  : undefined;

const storage = new Storage(storageOptions);

const buckets = {
  data: storage.bucket(env.DATA_BUCKET_NAME),
  public: storage.bucket(env.PUBLIC_BUCKET_NAME),
} as const;

async function saveObject(
  key: string,
  data: Buffer,
  bucket: Bucket,
  contentType = 'application/octet-stream',
): Promise<boolean> {
  const file = bucket.file(key);

  await new Promise<void>((resolve, reject) => {
    const stream = file.createWriteStream({
      resumable: false,
      metadata: { contentType },
    });

    stream.on('error', reject);
    stream.on('finish', resolve);
    stream.end(data);
  });

  return true;
}

async function loadObject(key: string, bucket: Bucket): Promise<LoadedData | null> {
  if (!key) return null;

  try {
    const file = bucket.file(key);
    const [metadata] = await file.getMetadata();
    const [buffer] = await file.download();

    return {
      buffer,
      contentType: metadata.contentType,
    };
  } catch (error) {
    const storageError = error as Error & {
      code?: number;
      errors?: Array<{ reason?: string }>;
    };

    if (
      storageError.message === 'A file name must be specified.' ||
      storageError.code === 404 ||
      storageError.errors?.[0]?.reason === 'notFound'
    ) {
      return null;
    }

    throw error;
  }
}

async function createObjectLink(
  key: string,
  bucket: Bucket,
  expires = new Date(Date.now() + 60 * 60 * 1000),
): Promise<string | null> {
  if (!key) return null;

  const file = bucket.file(key);
  const [exists] = await file.exists();

  if (!exists) {
    console.warn(`Object "${key}" does not exist in bucket "${bucket.name}".`);
    return null;
  }

  try {
    const options: GetSignedUrlConfig = {
      version: 'v4',
      action: 'read',
      expires,
    };

    const [url] = await file.getSignedUrl(options);
    return url;
  } catch (error) {
    console.error(`Error creating signed URL for "${key}":`, error);
    return null;
  }
}

async function deleteObject(key: string, bucket: Bucket): Promise<boolean> {
  if (!key) return false;

  try {
    const file = bucket.file(key);
    const [exists] = await file.exists();

    if (!exists) {
      console.warn(`Object "${key}" does not exist in bucket "${bucket.name}".`);
      return false;
    }

    await file.delete();
    return true;
  } catch (error) {
    console.error(`Error deleting "${key}" from "${bucket.name}":`, error);
    return false;
  }
}

async function deleteObjectsOlderThan(
  bucket: Bucket,
  maxAgeMs = 24 * 60 * 60 * 1000,
): Promise<{ deletedCount: number; deletedKeys: string[] }> {
  const cutoff = Date.now() - maxAgeMs;
  const [files] = await bucket.getFiles();

  const filesToDelete = files.filter(file => {
    const createdAt = file.metadata.timeCreated;
    if (!createdAt) return false;

    return new Date(createdAt).getTime() < cutoff;
  });

  await Promise.all(
    filesToDelete.map(async file => {
      try {
        await file.delete();
      } catch (error) {
        console.error(`Failed to delete "${file.name}" from "${bucket.name}"`, error);
      }
    }),
  );

  return {
    deletedCount: filesToDelete.length,
    deletedKeys: filesToDelete.map(file => file.name),
  };
}

async function getPublicUrl(key: string): Promise<string | null> {
  if (!key) return null;

  const file = buckets.public.file(key);
  const [exists] = await file.exists();

  if (!exists) {
    console.warn(`Object "${key}" does not exist in public bucket "${buckets.public.name}".`);
    return null;
  }

  return `https://storage.googleapis.com/${buckets.public.name}/${key}`;
}

const gcpBucketObjectStore: ObjectStorePlugin = {
  saveData: (key, data, contentType) => saveObject(key, data, buckets.data, contentType),
  loadData: key => loadObject(key, buckets.data),
  createDataLink: (key, expires) => createObjectLink(key, buckets.data, expires),
  deleteData: key => deleteObject(key, buckets.data),
  deleteDataOlderThan: maxAgeMs => deleteObjectsOlderThan(buckets.data, maxAgeMs),
  savePublicData: (key, data, contentType) => saveObject(key, data, buckets.public, contentType),
  loadPublicData: key => loadObject(key, buckets.public),
  getPublicUrl,
  deletePublicData: key => deleteObject(key, buckets.public),
};

export default gcpBucketObjectStore;
