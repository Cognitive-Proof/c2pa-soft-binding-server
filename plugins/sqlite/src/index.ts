import { v4 as uuidv4 } from 'uuid';
import type { DataStorePlugin, Receipt } from '@cognitiveproof/softbinding-api-plugin-types';
import { db } from './client';

interface ManifestRow {
  data: Buffer;
  content_type: string;
  receipt: string | null;
}

interface BindingRow {
  manifest_id: string;
}

const sqliteDataStore: DataStorePlugin = {
  async addManifest(data, contentType) {
    const manifestId = `urn:c2pa:${uuidv4()}`;
    db.prepare(
      'INSERT INTO manifests (id, data, content_type, receipt) VALUES (?, ?, ?, NULL)',
    ).run(manifestId, data, contentType);
    return manifestId;
  },

  async getManifest(manifestId) {
    const row = db
      .prepare('SELECT data, content_type, receipt FROM manifests WHERE id = ?')
      .get(manifestId) as ManifestRow | undefined;
    if (!row) return null;
    return {
      data: row.data,
      contentType: row.content_type,
      receipt: row.receipt ? (JSON.parse(row.receipt) as Receipt) : null,
    };
  },

  async manifestExists(manifestId) {
    const row = db.prepare('SELECT 1 FROM manifests WHERE id = ?').get(manifestId);
    return row !== undefined;
  },

  async deleteManifest(manifestId) {
    const result = db.prepare('DELETE FROM manifests WHERE id = ?').run(manifestId);
    return result.changes > 0;
  },

  async createBinding(bindingValue, manifestId) {
    if (!(await sqliteDataStore.manifestExists(manifestId))) return false;
    db.prepare('INSERT OR IGNORE INTO bindings (binding_value, manifest_id) VALUES (?, ?)').run(
      bindingValue,
      manifestId,
    );
    return true;
  },

  // PUT semantics: replace all existing associations for this binding value
  async updateBinding(bindingValue, manifestId) {
    const exists = db
      .prepare('SELECT 1 FROM bindings WHERE binding_value = ? LIMIT 1')
      .get(bindingValue);
    if (!exists) return false;
    if (!(await sqliteDataStore.manifestExists(manifestId))) return false;

    const replace = db.transaction((value: string, id: string) => {
      db.prepare('DELETE FROM bindings WHERE binding_value = ?').run(value);
      db.prepare('INSERT INTO bindings (binding_value, manifest_id) VALUES (?, ?)').run(value, id);
    });
    replace(bindingValue, manifestId);
    return true;
  },

  async findByBinding(bindingValue, maxResults = 10) {
    const rows = db
      .prepare('SELECT manifest_id FROM bindings WHERE binding_value = ? ORDER BY id ASC LIMIT ?')
      .all(bindingValue, maxResults) as BindingRow[];
    return rows.map((row) => ({ manifestId: row.manifest_id, similarityScore: 100 }));
  },

  async setReceipt(manifestId, receipt) {
    const result = db
      .prepare('UPDATE manifests SET receipt = ? WHERE id = ?')
      .run(JSON.stringify(receipt), manifestId);
    return result.changes > 0;
  },

  async getReceipt(manifestId) {
    const row = db.prepare('SELECT receipt FROM manifests WHERE id = ?').get(manifestId) as
      { receipt: string | null } | undefined;
    if (!row?.receipt) return null;
    return JSON.parse(row.receipt) as Receipt;
  },
};

export default sqliteDataStore;
