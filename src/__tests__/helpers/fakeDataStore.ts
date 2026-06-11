import type { DataStorePlugin, ManifestEntry, Match, Receipt } from '@cognitiveproof/softbinding-api-plugin-types';

let nextId = 0;

/** A simple in-memory DataStorePlugin for testing route handlers. */
export function createFakeDataStore(): DataStorePlugin {
  const manifests = new Map<string, ManifestEntry>();
  const bindings = new Map<string, string>();

  return {
    async addManifest(data: Buffer, contentType: string): Promise<string> {
      const manifestId = `urn:c2pa:test-${++nextId}`;
      manifests.set(manifestId, { data, contentType, receipt: null });
      return manifestId;
    },

    async getManifest(manifestId: string): Promise<ManifestEntry | null> {
      return manifests.get(manifestId) ?? null;
    },

    async manifestExists(manifestId: string): Promise<boolean> {
      return manifests.has(manifestId);
    },

    async deleteManifest(manifestId: string): Promise<boolean> {
      if (!manifests.has(manifestId)) return false;
      manifests.delete(manifestId);
      for (const [binding, target] of bindings) {
        if (target === manifestId) bindings.delete(binding);
      }
      return true;
    },

    async createBinding(bindingValue: string, manifestId: string): Promise<boolean> {
      if (!manifests.has(manifestId)) return false;
      bindings.set(bindingValue, manifestId);
      return true;
    },

    async updateBinding(bindingValue: string, manifestId: string): Promise<boolean> {
      if (!bindings.has(bindingValue)) return false;
      bindings.set(bindingValue, manifestId);
      return true;
    },

    async findByBinding(bindingValue: string, maxResults = 10): Promise<Match[]> {
      const manifestId = bindings.get(bindingValue);
      if (!manifestId) return [];
      return [{ manifestId, similarityScore: 1 }].slice(0, maxResults);
    },

    async setReceipt(manifestId: string, receipt: Receipt): Promise<boolean> {
      const entry = manifests.get(manifestId);
      if (!entry) return false;
      entry.receipt = receipt;
      return true;
    },

    async getReceipt(manifestId: string): Promise<Receipt | null> {
      return manifests.get(manifestId)?.receipt ?? null;
    },
  };
}
