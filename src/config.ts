import crypto from 'crypto';

export const PORT = parseInt(process.env.PORT ?? '3000', 10);
export const REPO_URI = process.env.REPO_URI ?? 'http://localhost:3000';
// Generate a random secret if none is configured (ephemeral — receipts won't survive restart)
export const RECEIPT_SECRET =
  process.env.RECEIPT_SECRET ?? crypto.randomBytes(32).toString('hex');
export const MAX_UPLOAD_SIZE = parseInt(process.env.MAX_UPLOAD_SIZE ?? '52428800', 10);
export const MAX_REFERENCE_SIZE = parseInt(process.env.MAX_REFERENCE_SIZE ?? '104857600', 10);
