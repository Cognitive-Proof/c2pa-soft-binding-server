import { type Document, type Filter } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import { getCollection, getDocById, insertDoc, updateDoc } from './db/client';

export interface Receipt {
  '@context': { c2pa: string; receipt: string };
  '@type': string;
  repository: { uri: string; manifestId: string };
  anchor: { uri: string; proof: { alg: string; value: string } };
  verified?: boolean;
  error?: string;
}

export interface Match {
  manifestId: string;
  similarityScore: number;
}

interface ManifestEntry {
  data: Buffer;
  contentType: string;
  receipt: Receipt | null;
}

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

export async function addManifest(data: Buffer, contentType: string): Promise<string> {
  const manifestId = `urn:c2pa:${uuidv4()}`;
  await insertDoc<ManifestDoc>(MANIFESTS, {
    id: manifestId,
    data: data.toString('base64'),
    contentType,
    receipt: null,
  });
  return manifestId;
}

export async function getManifest(manifestId: string): Promise<ManifestEntry | null> {
  const doc = await getDocById<ManifestDoc>(MANIFESTS, manifestId);
  if (!doc) return null;
  return {
    data: Buffer.from(doc.data, 'base64'),
    contentType: doc.contentType,
    receipt: doc.receipt,
  };
}

export async function manifestExists(manifestId: string): Promise<boolean> {
  const doc = await getDocById<ManifestDoc>(MANIFESTS, manifestId);
  return doc !== null;
}

export async function deleteManifest(manifestId: string): Promise<boolean> {
  const manifestCol = await getCollection<ManifestDoc>(MANIFESTS);
  const result = await manifestCol.deleteOne({ id: manifestId } as Filter<ManifestDoc>);
  if (result.deletedCount === 0) return false;

  // Cascade: pull this manifestId from every binding, then delete empty binding docs
  const bindingCol = await getCollection<BindingDoc>(BINDINGS);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await bindingCol.updateMany({}, { $pull: { manifestIds: manifestId } } as any);
  await bindingCol.deleteMany({ manifestIds: { $size: 0 } } as Filter<BindingDoc>);

  return true;
}

export async function createBinding(bindingValue: string, manifestId: string): Promise<boolean> {
  if (!(await manifestExists(manifestId))) return false;
  const col = await getCollection<BindingDoc>(BINDINGS);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await col.updateOne({ id: bindingValue }, { $addToSet: { manifestIds: manifestId } } as any, {
    upsert: true,
  });
  return true;
}

// PUT semantics: replace all existing associations for this binding value
export async function updateBinding(bindingValue: string, manifestId: string): Promise<boolean> {
  const doc = await getDocById<BindingDoc>(BINDINGS, bindingValue);
  if (!doc) return false;
  if (!(await manifestExists(manifestId))) return false;
  await updateDoc<BindingDoc>(
    BINDINGS,
    { id: bindingValue } as Filter<BindingDoc>,
    { manifestIds: [manifestId] },
  );
  return true;
}

export async function findByBinding(bindingValue: string, maxResults = 10): Promise<Match[]> {
  const doc = await getDocById<BindingDoc>(BINDINGS, bindingValue);
  if (!doc || doc.manifestIds.length === 0) return [];
  return doc.manifestIds
    .slice(0, maxResults)
    .map(manifestId => ({ manifestId, similarityScore: 100 }));
}

export async function setReceipt(manifestId: string, receipt: Receipt): Promise<boolean> {
  const doc = await getDocById<ManifestDoc>(MANIFESTS, manifestId);
  if (!doc) return false;
  await updateDoc<ManifestDoc>(MANIFESTS, { id: manifestId } as Filter<ManifestDoc>, { receipt });
  return true;
}

export async function getReceipt(manifestId: string): Promise<Receipt | null> {
  const doc = await getDocById<ManifestDoc>(MANIFESTS, manifestId);
  return doc?.receipt ?? null;
}
