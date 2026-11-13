import type { LoadedData, ObjectStorePlugin } from '@cognitiveproof/softbinding-api-plugin-types';

/** In-memory ObjectStorePlugin for route tests. Only the private bucket is backed. */
export function createFakeObjectStore(): ObjectStorePlugin & { objects: Map<string, LoadedData> } {
  const objects = new Map<string, LoadedData>();

  return {
    objects,
    async saveData(key, data, contentType) {
      objects.set(key, { buffer: Buffer.from(data), contentType });
      return true;
    },
    async loadData(key) {
      return objects.get(key) ?? null;
    },
    async createDataLink() {
      return null;
    },
    async deleteData(key) {
      return objects.delete(key);
    },
    async deleteDataOlderThan() {
      return { deletedCount: 0, deletedKeys: [] };
    },
    async savePublicData() {
      return false;
    },
    async loadPublicData() {
      return null;
    },
    async getPublicUrl() {
      return null;
    },
    async deletePublicData() {
      return false;
    },
  };
}
