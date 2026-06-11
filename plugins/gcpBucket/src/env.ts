const skip = Boolean(process.env.SKIP_ENV_VALIDATION);

function requireStr(name: string): string {
  if (skip) return '';
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function parseOptionalJson(name: string): object | undefined {
  const value = process.env[name];
  if (!value) return undefined;
  try {
    return JSON.parse(value) as object;
  } catch {
    throw new Error(`Environment variable ${name} is not valid JSON`);
  }
}

export const env = {
  DATA_BUCKET_NAME: requireStr('DATA_BUCKET_NAME'),
  PUBLIC_BUCKET_NAME: requireStr('PUBLIC_BUCKET_NAME'),
  GOOGLE_BUCKET_CREDENTIAL: parseOptionalJson('GOOGLE_BUCKET_CREDENTIAL'),
};
