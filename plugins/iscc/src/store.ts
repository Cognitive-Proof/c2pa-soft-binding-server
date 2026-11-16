// Where the ISCC matcher keeps the searchable units of stored manifests.

/** A searchable 256-bit unit of a stored manifest. `key` is MainType-SubType-Version. */
export interface StoredUnit {
  key: string;
  body: Buffer;
}

export interface UnitStore {
  add(manifestId: string, units: StoredUnit[]): Promise<void>;
  remove(manifestId: string): Promise<void>;
  /** Every stored unit with this key. */
  byKey(key: string): Promise<Array<{ manifestId: string; body: Buffer }>>;
}

/** Keeps units in process memory: for tests and single-instance servers that rebuild on start. */
export function createMemoryUnitStore(): UnitStore {
  const rows: Array<{ manifestId: string; key: string; body: Buffer }> = [];

  return {
    async add(manifestId, units) {
      for (const unit of units) {
        if (
          !rows.some(
            (r) => r.manifestId === manifestId && r.key === unit.key && r.body.equals(unit.body),
          )
        ) {
          rows.push({ manifestId, ...unit });
        }
      }
    },
    async remove(manifestId) {
      for (let i = rows.length - 1; i >= 0; i--)
        if (rows[i].manifestId === manifestId) rows.splice(i, 1);
    },
    async byKey(key) {
      return rows
        .filter((r) => r.key === key)
        .map(({ manifestId, body }) => ({ manifestId, body }));
    },
  };
}

/** One unit document in MongoDB. */
export interface UnitDocument {
  manifestId: string;
  key: string;
  body: Buffer;
}

/**
 * The parts of a MongoDB driver `Collection` this store uses, so the plugin
 * doesn't depend on a particular driver version. Pass e.g.
 * `client.db().collection('isccUnits')`.
 */
export interface UnitCollection {
  createIndex(spec: Record<string, 1 | -1>, options?: { unique?: boolean }): Promise<unknown>;
  updateOne(
    filter: UnitDocument,
    update: { $setOnInsert: UnitDocument },
    options: { upsert: true },
  ): Promise<unknown>;
  deleteMany(filter: { manifestId: string }): Promise<unknown>;
  find(
    filter: { key: string },
    options: { projection: Record<string, 0 | 1> },
  ): { toArray(): Promise<Array<{ manifestId: string; body: unknown }>> };
}

// The driver returns BSON Binary values; their bytes are in `.buffer`.
function toBuffer(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  const inner = (value as { buffer?: unknown } | null)?.buffer;
  if (inner instanceof Uint8Array) return Buffer.from(inner);
  throw new Error('Unexpected unit body type in MongoDB');
}

/** Keeps units in a MongoDB collection, indexed by key and by manifest. */
export function createMongoUnitStore(collection: UnitCollection): UnitStore {
  let indexed: Promise<unknown> | undefined;
  const ensureIndexes = () =>
    (indexed ??= Promise.all([
      collection.createIndex({ key: 1 }),
      collection.createIndex({ manifestId: 1, key: 1, body: 1 }, { unique: true }),
    ]));

  return {
    async add(manifestId, units) {
      await ensureIndexes();
      for (const unit of units) {
        const doc = { manifestId, key: unit.key, body: unit.body };
        await collection.updateOne(doc, { $setOnInsert: doc }, { upsert: true });
      }
    },
    async remove(manifestId) {
      await ensureIndexes();
      await collection.deleteMany({ manifestId });
    },
    async byKey(key) {
      await ensureIndexes();
      const docs = await collection
        .find({ key }, { projection: { _id: 0, manifestId: 1, body: 1 } })
        .toArray();
      return docs.map((doc) => ({ manifestId: doc.manifestId, body: toBuffer(doc.body) }));
    },
  };
}
