const skip = Boolean(process.env.SKIP_ENV_VALIDATION);

function requireStr(name: string): string {
  if (skip) return '';
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export const env = {
  // PostgreSQL connection string, e.g. postgres://user:pass@host:5432/dbname
  POSTGRES_URL: requireStr('POSTGRES_URL'),
};
