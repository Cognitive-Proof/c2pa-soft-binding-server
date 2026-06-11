import path from 'path';
import fs from 'fs';
import Database, { type Database as DatabaseType } from 'better-sqlite3';
import { env } from './env';

const dbPath = env.SQLITE_DB_PATH;

if (dbPath !== ':memory:') {
  const dir = path.dirname(dbPath);
  if (dir && dir !== '.') fs.mkdirSync(dir, { recursive: true });
}

export const db: DatabaseType = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS manifests (
    id TEXT PRIMARY KEY,
    data BLOB NOT NULL,
    content_type TEXT NOT NULL,
    receipt TEXT
  );

  CREATE TABLE IF NOT EXISTS bindings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    binding_value TEXT NOT NULL,
    manifest_id TEXT NOT NULL REFERENCES manifests(id) ON DELETE CASCADE,
    UNIQUE (binding_value, manifest_id)
  );

  CREATE INDEX IF NOT EXISTS idx_bindings_value ON bindings(binding_value);
`);
