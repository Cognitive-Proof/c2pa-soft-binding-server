import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import { v4 as uuidv4 } from 'uuid';
import type { DataStorePlugin, Receipt } from '@cognitiveproof/softbinding-api-plugin-types';
import { pool, ready } from './client';

interface ManifestRow extends RowDataPacket {
  data: Buffer;
  content_type: string;
  receipt: string | null;
}

interface BindingRow extends RowDataPacket {
  manifest_id: string;
}

const mysqlDataStore: DataStorePlugin = {
  async addManifest(data, contentType, manifestId = `urn:c2pa:${uuidv4()}`) {
    await ready();
    await pool.query(
      'INSERT INTO manifests (id, data, content_type, receipt) VALUES (?, ?, ?, NULL)',
      [manifestId, data, contentType],
    );
    return manifestId;
  },

  async getManifest(manifestId) {
    await ready();
    const [rows] = await pool.query<ManifestRow[]>(
      'SELECT data, content_type, receipt FROM manifests WHERE id = ?',
      [manifestId],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      data: row.data,
      contentType: row.content_type,
      receipt: row.receipt ? (JSON.parse(row.receipt) as Receipt) : null,
    };
  },

  async manifestExists(manifestId) {
    await ready();
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT 1 FROM manifests WHERE id = ? LIMIT 1',
      [manifestId],
    );
    return rows.length > 0;
  },

  async deleteManifest(manifestId) {
    await ready();
    const [result] = await pool.query<ResultSetHeader>('DELETE FROM manifests WHERE id = ?', [
      manifestId,
    ]);
    return result.affectedRows > 0;
  },

  async createBinding(bindingValue, manifestId) {
    await ready();
    const [existing] = await pool.query<RowDataPacket[]>(
      'SELECT 1 FROM manifests WHERE id = ? LIMIT 1',
      [manifestId],
    );
    if (existing.length === 0) return false;

    await pool.query('INSERT IGNORE INTO bindings (binding_value, manifest_id) VALUES (?, ?)', [
      bindingValue,
      manifestId,
    ]);
    return true;
  },

  // PUT semantics: replace all existing associations for this binding value
  async updateBinding(bindingValue, manifestId) {
    await ready();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [bindingRows] = await conn.query<RowDataPacket[]>(
        'SELECT 1 FROM bindings WHERE binding_value = ? LIMIT 1',
        [bindingValue],
      );
      if (bindingRows.length === 0) {
        await conn.rollback();
        return false;
      }

      const [manifestRows] = await conn.query<RowDataPacket[]>(
        'SELECT 1 FROM manifests WHERE id = ? LIMIT 1',
        [manifestId],
      );
      if (manifestRows.length === 0) {
        await conn.rollback();
        return false;
      }

      await conn.query('DELETE FROM bindings WHERE binding_value = ?', [bindingValue]);
      await conn.query('INSERT INTO bindings (binding_value, manifest_id) VALUES (?, ?)', [
        bindingValue,
        manifestId,
      ]);

      await conn.commit();
      return true;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  },

  async findByBinding(bindingValue, maxResults = 10) {
    await ready();
    const [rows] = await pool.query<BindingRow[]>(
      'SELECT manifest_id FROM bindings WHERE binding_value = ? ORDER BY id ASC LIMIT ?',
      [bindingValue, maxResults],
    );
    return rows.map((row) => ({ manifestId: row.manifest_id, similarityScore: 100 }));
  },

  async setReceipt(manifestId, receipt) {
    await ready();
    const [result] = await pool.query<ResultSetHeader>(
      'UPDATE manifests SET receipt = ? WHERE id = ?',
      [JSON.stringify(receipt), manifestId],
    );
    return result.affectedRows > 0;
  },

  async getReceipt(manifestId) {
    await ready();
    const [rows] = await pool.query<RowDataPacket[]>('SELECT receipt FROM manifests WHERE id = ?', [
      manifestId,
    ]);
    const row = rows[0] as { receipt: string | null } | undefined;
    if (!row?.receipt) return null;
    return JSON.parse(row.receipt) as Receipt;
  },
};

export default mysqlDataStore;
