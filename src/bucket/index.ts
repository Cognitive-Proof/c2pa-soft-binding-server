/**
 * @fileoverview Google Cloud Storage helpers for the Trust Registry data bucket.
 *
 * This module provides a small interface for reading, writing, linking, and
 * deleting objects in the configured data bucket.
 *
 * Required environment variables:
 * - DATA_BUCKET_NAME: Google Cloud Storage bucket name for registry data.
 * - GOOGLE_BUCKET_CREDENTIAL: Service account JSON string for bucket access.
 */

import {
  type Bucket,
  type GetSignedUrlConfig,
  Storage,
  type StorageOptions,
  
} from "@google-cloud/storage";

import { env } from "../env";


const storageOptions:StorageOptions|undefined = env.GOOGLE_BUCKET_CREDENTIAL ? {
  // The `GOOGLE_BUCKET_CREDENTIAL` variable is expected to be a JSON string
  // containing the service account credentials. It is parsed and validated in
  // `src/env.js` before being passed here. If the variable is not set, `credentials` will be `undefined`, and the
  // Storage client will use default application credentials or other configured
  // authentication methods.
  credentials: env.GOOGLE_BUCKET_CREDENTIAL as StorageOptions["credentials"],
} : undefined;
/**
 * Shared Google Cloud Storage client.
 *
 * Credentials are parsed and validated in `src/env.js` from
 * `GOOGLE_BUCKET_CREDENTIAL`.
 */
const storage = new Storage(storageOptions);

/**
 * Central bucket registry.
 *
 * `data` stores Trust Registry generated data and other application-owned
 * object payloads.
 */
const buckets = {
  data: storage.bucket(env.DATA_BUCKET_NAME),
  public: storage.bucket(env.PUBLIC_BUCKET_NAME),
} as const;

/**
 * Standard in-memory representation of an object loaded from storage.
 *
 * @property buffer - The raw object bytes.
 * @property contentType - The object's MIME type when present in metadata.
 */
export type LoadedData = {
  buffer: Buffer;
  contentType?: string;
};

/**
 * Uploads a buffer to a GCS bucket.
 *
 * @param key - Object path/name inside the bucket.
 * @param data - Object bytes.
 * @param bucket - Bucket to upload into.
 * @param contentType - MIME type for the object.
 * @returns `true` when the upload succeeds.
 */
const saveObject = async (
  key: string,
  data: Buffer,
  bucket: Bucket,
  contentType = "application/octet-stream",
): Promise<boolean> => {
  const file = bucket.file(key);

  await new Promise<void>((resolve, reject) => {
    const stream = file.createWriteStream({
      resumable: false,
      metadata: { contentType },
    });

    stream.on("error", reject);
    stream.on("finish", resolve);
    stream.end(data);
  });

  return true;
};

/**
 * Loads an object from a GCS bucket into memory.
 *
 * Returns `null` when the key is empty or the object does not exist. Other GCS
 * errors are re-thrown.
 *
 * @param key - Object path/name inside the bucket.
 * @param bucket - Bucket to read from.
 * @returns Loaded object data, or `null` when no object exists for the key.
 */
const loadObject = async (
  key: string,
  bucket: Bucket,
): Promise<LoadedData | null> => {
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
      storageError.message === "A file name must be specified." ||
      storageError.code === 404 ||
      storageError.errors?.[0]?.reason === "notFound"
    ) {
      return null;
    }

    throw error;
  }
};

/**
 * Creates a signed read URL for an object.
 *
 * @param key - Object path/name inside the bucket.
 * @param bucket - Bucket containing the object.
 * @param expires - Expiration date/time for the URL.
 * @returns Signed URL, or `null` when the key is empty or object is missing.
 */
const createObjectLink = async (
  key: string,
  bucket: Bucket,
  expires = new Date(Date.now() + 60 * 60 * 1000),
): Promise<string | null> => {
  if (!key) return null;

  const file = bucket.file(key);
  const [exists] = await file.exists();

  if (!exists) {
    console.warn(`Object "${key}" does not exist in bucket "${bucket.name}".`);
    return null;
  }

  try {
    const options: GetSignedUrlConfig = {
      version: "v4",
      action: "read",
      expires,
    };

    const [url] = await file.getSignedUrl(options);
    return url;
  } catch (error) {
    console.error(`Error creating signed URL for "${key}":`, error);
    return null;
  }
};

/**
 * Deletes an object from a GCS bucket.
 *
 * @param key - Object path/name inside the bucket.
 * @param bucket - Bucket containing the object.
 * @returns `true` when the object was deleted; `false` when missing or failed.
 */
const deleteObject = async (key: string, bucket: Bucket): Promise<boolean> => {
  if (!key) return false;

  try {
    const file = bucket.file(key);
    const [exists] = await file.exists();

    if (!exists) {
      console.warn(
        `Object "${key}" does not exist in bucket "${bucket.name}".`,
      );
      return false;
    }

    await file.delete();
    return true;
  } catch (error) {
    console.error(`Error deleting "${key}" from "${bucket.name}":`, error);
    return false;
  }
};

/**
 * Deletes objects older than a specified threshold.
 *
 * @param bucket - Bucket to clean.
 * @param maxAgeMs - Maximum object age in milliseconds.
 * @returns Count and keys for objects selected for deletion.
 */
const deleteObjectsOlderThan = async (
  bucket: Bucket,
  maxAgeMs = 24 * 60 * 60 * 1000,
): Promise<{
  deletedCount: number;
  deletedKeys: string[];
}> => {
  const cutoff = Date.now() - maxAgeMs;
  const [files] = await bucket.getFiles();

  const filesToDelete = files.filter((file) => {
    const createdAt = file.metadata.timeCreated;
    if (!createdAt) return false;

    return new Date(createdAt).getTime() < cutoff;
  });

  await Promise.all(
    filesToDelete.map(async (file) => {
      try {
        await file.delete();
      } catch (error) {
        console.error(
          `Failed to delete "${file.name}" from "${bucket.name}"`,
          error,
        );
      }
    }),
  );

  return {
    deletedCount: filesToDelete.length,
    deletedKeys: filesToDelete.map((file) => file.name),
  };
};

/**
 * Saves an object to the data bucket.
 *
 * @param key - Object path/name inside the data bucket.
 * @param data - Object bytes.
 * @param contentType - MIME type for the object.
 * @returns `true` when the upload succeeds.
 */
export const saveData = (
  key: string,
  data: Buffer,
  contentType = "application/octet-stream",
) => saveObject(key, data, buckets.data, contentType);

/**
 * Loads an object from the data bucket.
 *
 * @param key - Object path/name inside the data bucket.
 * @returns Loaded object data, or `null` when no object exists for the key.
 */
export const loadData = (key: string): Promise<LoadedData | null> =>
  loadObject(key, buckets.data);

/**
 * Creates a signed read URL for an object in the data bucket.
 *
 * @param key - Object path/name inside the data bucket.
 * @param expires - Expiration date/time for the URL.
 * @returns Signed URL, or `null` when the key is empty or object is missing.
 */
export const createDataLink = (
  key: string,
  expires?: Date,
): Promise<string | null> => createObjectLink(key, buckets.data, expires);

/**
 * Deletes an object from the data bucket.
 *
 * @param key - Object path/name inside the data bucket.
 * @returns `true` when the object was deleted; `false` when missing or failed.
 */
export const deleteData = (key: string) => deleteObject(key, buckets.data);

/**
 * Deletes data bucket objects older than a specified threshold.
 *
 * @param maxAgeMs - Maximum object age in milliseconds.
 * @returns Count and keys for objects selected for deletion.
 */
export const deleteDataOlderThan = (maxAgeMs?: number) =>
  deleteObjectsOlderThan(buckets.data, maxAgeMs);

/**
 * Uploads a buffer to the public bucket and makes the object publicly readable.
 *
 * @param key - Object path/name inside the public bucket.
 * @param data - Object bytes.
 * @param contentType - MIME type for the object.
 * @returns `true` when the upload succeeds.
 */
export const savePublicData = async (
  key: string,
  data: Buffer,
  contentType = "application/octet-stream",
): Promise<boolean> => {
 return saveObject(key, data, buckets.public, contentType);
};

/**
 * Loads an object from the public bucket into memory.
 *
 * @param key - Object path/name inside the public bucket.
 * @returns Loaded object data, or `null` when no object exists for the key.
 */
export const loadPublicData = (key: string): Promise<LoadedData | null> =>
  loadObject(key, buckets.public);

/**
 * Returns the direct public URL for an object in the public bucket.
 *
 * @param key - Object path/name inside the public bucket.
 * @returns Public URL string, or `null` when the key is empty or object is missing.
 */
export const getPublicUrl = async (key: string): Promise<string | null> => {
  if (!key) return null;

  const file = buckets.public.file(key);
  const [exists] = await file.exists();

  if (!exists) {
    console.warn(`Object "${key}" does not exist in public bucket "${buckets.public.name}".`);
    return null;
  }

  return `https://storage.googleapis.com/${buckets.public.name}/${key}`;
};

/**
 * Deletes an object from the public bucket.
 *
 * @param key - Object path/name inside the public bucket.
 * @returns `true` when the object was deleted; `false` when missing or failed.
 */
export const deletePublicData = (key: string) =>
  deleteObject(key, buckets.public);
