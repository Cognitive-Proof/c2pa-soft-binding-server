import mysql from 'mysql2/promise';
import { env } from './env';

export const pool = mysql.createPool(env.MYSQL_URL);

const schemaReady = (async () => {
  const conn = await pool.getConnection();
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS manifests (
        id VARCHAR(255) PRIMARY KEY,
        data LONGBLOB NOT NULL,
        content_type VARCHAR(255) NOT NULL,
        receipt TEXT
      )
    `);
    await conn.query(`
      CREATE TABLE IF NOT EXISTS bindings (
        id INT AUTO_INCREMENT PRIMARY KEY,
        binding_value VARCHAR(512) NOT NULL,
        manifest_id VARCHAR(255) NOT NULL,
        UNIQUE KEY uniq_binding_manifest (binding_value, manifest_id),
        KEY idx_binding_value (binding_value),
        FOREIGN KEY (manifest_id) REFERENCES manifests(id) ON DELETE CASCADE
      )
    `);
  } finally {
    conn.release();
  }
})();

export async function ready(): Promise<void> {
  await schemaReady;
}
