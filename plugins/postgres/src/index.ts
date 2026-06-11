import { v4 as uuidv4 } from 'uuid';
import type { DataStorePlugin, Receipt } from '@cognitiveproof/softbinding-api-plugin-types';
import { pool, ready } from './client';

interface ManifestRow {
  data: Buffer;
  content_type: string;
  receipt: string | null;
}

interface BindingRow {
  manifest_id: string;
}

const postgresDataStore: DataStorePlugin = {
  async addManifest(data, contentType) {
    await ready();
    const manifestId = `urn:c2pa:${uuidv4()}`;
    await pool.query('INSERT INTO manifests (id, data, content_type, receipt) VALUES ($1, $2, $3, NULL)', [
      manifestId,
      data,
      contentType,
    ]);
    return manifestId;
  },

  async getManifest(manifestId) {
    await ready();
    const result = await pool.query<ManifestRow>(
      'SELECT data, content_type, receipt FROM manifests WHERE id = $1',
      [manifestId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      data: row.data,
      contentType: row.content_type,
      receipt: row.receipt ? (JSON.parse(row.receipt) as Receipt) : null,
    };
  },

  async manifestExists(manifestId) {
    await ready();
    const result = await pool.query('SELECT 1 FROM manifests WHERE id = $1', [manifestId]);
    return (result.rowCount ?? 0) > 0;
  },

  async deleteManifest(manifestId) {
    await ready();
    const result = await pool.query('DELETE FROM manifests WHERE id = $1', [manifestId]);
    return (result.rowCount ?? 0) > 0;
  },

  async createBinding(bindingValue, manifestId) {
    await ready();
    const exists = await pool.query('SELECT 1 FROM manifests WHERE id = $1', [manifestId]);
    if ((exists.rowCount ?? 0) === 0) return false;

    await pool.query(
      'INSERT INTO bindings (binding_value, manifest_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [bindingValue, manifestId],
    );
    return true;
  },

  // PUT semantics: replace all existing associations for this binding value
  async updateBinding(bindingValue, manifestId) {
    await ready();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const existing = await client.query('SELECT 1 FROM bindings WHERE binding_value = $1 LIMIT 1', [
        bindingValue,
      ]);
      if ((existing.rowCount ?? 0) === 0) {
        await client.query('ROLLBACK');
        return false;
      }

      const manifest = await client.query('SELECT 1 FROM manifests WHERE id = $1', [manifestId]);
      if ((manifest.rowCount ?? 0) === 0) {
        await client.query('ROLLBACK');
        return false;
      }

      await client.query('DELETE FROM bindings WHERE binding_value = $1', [bindingValue]);
      await client.query('INSERT INTO bindings (binding_value, manifest_id) VALUES ($1, $2)', [
        bindingValue,
        manifestId,
      ]);

      await client.query('COMMIT');
      return true;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async findByBinding(bindingValue, maxResults = 10) {
    await ready();
    const result = await pool.query<BindingRow>(
      'SELECT manifest_id FROM bindings WHERE binding_value = $1 ORDER BY id ASC LIMIT $2',
      [bindingValue, maxResults],
    );
    return result.rows.map(row => ({ manifestId: row.manifest_id, similarityScore: 100 }));
  },

  async setReceipt(manifestId, receipt) {
    await ready();
    const result = await pool.query('UPDATE manifests SET receipt = $1 WHERE id = $2', [
      JSON.stringify(receipt),
      manifestId,
    ]);
    return (result.rowCount ?? 0) > 0;
  },

  async getReceipt(manifestId) {
    await ready();
    const result = await pool.query<{ receipt: string | null }>(
      'SELECT receipt FROM manifests WHERE id = $1',
      [manifestId],
    );
    const row = result.rows[0];
    if (!row?.receipt) return null;
    return JSON.parse(row.receipt) as Receipt;
  },
};

export default postgresDataStore;
