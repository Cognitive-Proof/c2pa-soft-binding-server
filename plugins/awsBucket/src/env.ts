const skip = Boolean(process.env.SKIP_ENV_VALIDATION);

function requireStr(name: string): string {
  const value = process.env[name];
  if (!value) {
    if (skip) return '';
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  AWS_REGION: process.env.AWS_REGION || 'us-east-1',
  DATA_BUCKET_NAME: requireStr('DATA_BUCKET_NAME'),
  PUBLIC_BUCKET_NAME: requireStr('PUBLIC_BUCKET_NAME'),
  // Optional: custom S3-compatible endpoint (e.g. MinIO, R2, DigitalOcean Spaces).
  // If unset, the AWS SDK talks to AWS S3 directly.
  AWS_S3_ENDPOINT: process.env.AWS_S3_ENDPOINT,
  AWS_S3_FORCE_PATH_STYLE: process.env.AWS_S3_FORCE_PATH_STYLE === 'true',
};
