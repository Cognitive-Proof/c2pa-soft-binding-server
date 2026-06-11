const skip = Boolean(process.env.SKIP_ENV_VALIDATION);

function requireStr(name: string, skipDefault: string): string {
  if (skip) return skipDefault;
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export const env = {
  // MySQL connection string, e.g. mysql://user:pass@host:3306/dbname
  MYSQL_URL: requireStr('MYSQL_URL', 'mysql://localhost:3306/c2pa'),
};
