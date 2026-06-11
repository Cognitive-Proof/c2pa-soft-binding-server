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
  // PostgreSQL connection string, e.g. postgres://user:pass@host:5432/dbname
  POSTGRES_URL: requireStr('POSTGRES_URL'),
};
