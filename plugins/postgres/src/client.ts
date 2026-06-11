import { Pool } from 'pg';
import { env } from './env';

export const pool = new Pool({ connectionString: env.POSTGRES_URL });

const schemaReady = pool.query(`
  CREATE TABLE IF NOT EXISTS manifests (
    id TEXT PRIMARY KEY,
    data BYTEA NOT NULL,
    content_type TEXT NOT NULL,
    receipt TEXT
  );

  CREATE TABLE IF NOT EXISTS bindings (
    id SERIAL PRIMARY KEY,
    binding_value TEXT NOT NULL,
    manifest_id TEXT NOT NULL REFERENCES manifests(id) ON DELETE CASCADE,
    UNIQUE (binding_value, manifest_id)
  );

  CREATE INDEX IF NOT EXISTS idx_bindings_value ON bindings(binding_value);
`);

export async function ready(): Promise<void> {
  await schemaReady;
}
