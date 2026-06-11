import { type Document, type Filter } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import type { DataStorePlugin, ManifestEntry, Match, Receipt } from '@cognitiveproof/softbinding-api-plugin-types';
import { getCollection, getDocById, insertDoc, updateDoc } from './client';

// Internal MongoDB document shapes
interface ManifestDoc extends Document {
  id: string;
  data: string; // base64-encoded Buffer
  contentType: string;
  receipt: Receipt | null;
}

interface BindingDoc extends Document {
  id: string; // bindingValue
  manifestIds: string[];
}

const MANIFESTS = 'manifests';
const BINDINGS = 'bindings';

const mongoDataStore: DataStorePlugin = {
  async addManifest(data: Buffer, contentType: string): Promise<string> {
    const manifestId = `urn:c2pa:${uuidv4()}`;
    await insertDoc<ManifestDoc>(MANIFESTS, {
      id: manifestId,
      data: data.toString('base64'),
      contentType,
      receipt: null,
    });
    return manifestId;
  },

  async getManifest(manifestId: string): Promise<ManifestEntry | null> {
    const doc = await getDocById<ManifestDoc>(MANIFESTS, manifestId);
    if (!doc) return null;
    return {
      data: Buffer.from(doc.data, 'base64'),
      contentType: doc.contentType,
      receipt: doc.receipt,
    };
  },

  async manifestExists(manifestId: string): Promise<boolean> {
    const doc = await getDocById<ManifestDoc>(MANIFESTS, manifestId);
    return doc !== null;
  },

  async deleteManifest(manifestId: string): Promise<boolean> {
    const manifestCol = await getCollection<ManifestDoc>(MANIFESTS);
    const result = await manifestCol.deleteOne({ id: manifestId } as Filter<ManifestDoc>);
    if (result.deletedCount === 0) return false;

    // Cascade: pull this manifestId from every binding, then delete empty binding docs
    const bindingCol = await getCollection<BindingDoc>(BINDINGS);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await bindingCol.updateMany({}, { $pull: { manifestIds: manifestId } } as any);
    await bindingCol.deleteMany({ manifestIds: { $size: 0 } } as Filter<BindingDoc>);

    return true;
  },

  async createBinding(bindingValue: string, manifestId: string): Promise<boolean> {
    if (!(await mongoDataStore.manifestExists(manifestId))) return false;
    const col = await getCollection<BindingDoc>(BINDINGS);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await col.updateOne({ id: bindingValue }, { $addToSet: { manifestIds: manifestId } } as any, {
      upsert: true,
    });
    return true;
  },

  // PUT semantics: replace all existing associations for this binding value
  async updateBinding(bindingValue: string, manifestId: string): Promise<boolean> {
    const doc = await getDocById<BindingDoc>(BINDINGS, bindingValue);
    if (!doc) return false;
    if (!(await mongoDataStore.manifestExists(manifestId))) return false;
    await updateDoc<BindingDoc>(
      BINDINGS,
      { id: bindingValue } as Filter<BindingDoc>,
      { manifestIds: [manifestId] },
    );
    return true;
  },

  async findByBinding(bindingValue: string, maxResults = 10): Promise<Match[]> {
    const doc = await getDocById<BindingDoc>(BINDINGS, bindingValue);
    if (!doc || doc.manifestIds.length === 0) return [];
    return doc.manifestIds
      .slice(0, maxResults)
      .map(manifestId => ({ manifestId, similarityScore: 100 }));
  },

  async setReceipt(manifestId: string, receipt: Receipt): Promise<boolean> {
    const doc = await getDocById<ManifestDoc>(MANIFESTS, manifestId);
    if (!doc) return false;
    await updateDoc<ManifestDoc>(MANIFESTS, { id: manifestId } as Filter<ManifestDoc>, { receipt });
    return true;
  },

  async getReceipt(manifestId: string): Promise<Receipt | null> {
    const doc = await getDocById<ManifestDoc>(MANIFESTS, manifestId);
    return doc?.receipt ?? null;
  },
};

export default mongoDataStore;
