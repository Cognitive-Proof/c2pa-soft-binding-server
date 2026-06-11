import { S3Client } from '@aws-sdk/client-s3';
import { env } from './env';

export const s3 = new S3Client({
  region: env.AWS_REGION,
  ...(env.AWS_S3_ENDPOINT ? { endpoint: env.AWS_S3_ENDPOINT } : {}),
  ...(env.AWS_S3_FORCE_PATH_STYLE ? { forcePathStyle: true } : {}),
});

export const buckets = {
  data: env.DATA_BUCKET_NAME,
  public: env.PUBLIC_BUCKET_NAME,
} as const;
