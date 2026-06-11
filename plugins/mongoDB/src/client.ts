import {
  type Document,
  type Filter,
  MongoClient,
  type OptionalUnlessRequiredId,
  type UpdateFilter,
} from 'mongodb';

function mongoUri(): string {
  const skip = Boolean(process.env.SKIP_ENV_VALIDATION);
  const uri = process.env.MONGO_DB_URI;
  if (!uri) {
    if (skip) return 'mongodb://localhost:27017';
    throw new Error('Missing required environment variable: MONGO_DB_URI');
  }
  return uri;
}

const globalForMongo = globalThis as unknown as {
  mongoClient?: MongoClient;
  mongoClientPromise?: Promise<MongoClient>;
};

export const mongoClient = globalForMongo.mongoClient ?? new MongoClient(mongoUri());

const clientPromise = globalForMongo.mongoClientPromise ?? mongoClient.connect();

if (process.env.NODE_ENV !== 'production') {
  globalForMongo.mongoClient = mongoClient;
  globalForMongo.mongoClientPromise = clientPromise;
}

export async function getMongoClient(): Promise<MongoClient> {
  return clientPromise;
}

export async function getCollection<T extends Document>(collectionName: string) {
  const client = await getMongoClient();
  return client.db().collection<T>(collectionName);
}

export async function getDocById<T extends Document & { id: string }>(
  collectionName: string,
  id: string,
) {
  const collection = await getCollection<T>(collectionName);
  const filter: Filter<T> = { id } as Filter<T>;
  return collection.findOne(filter);
}

export async function insertDoc<T extends Document>(
  collectionName: string,
  doc: OptionalUnlessRequiredId<T>,
) {
  const collection = await getCollection<T>(collectionName);
  return collection.insertOne(doc);
}

export async function updateDoc<T extends Document>(
  collectionName: string,
  filter: Filter<T>,
  update: UpdateFilter<T> | Partial<T>,
  upsert = false,
) {
  const collection = await getCollection<T>(collectionName);
  const updateDoc = ('$set' in update ? update : { $set: update }) as UpdateFilter<T>;
  return collection.updateOne(filter, updateDoc, { upsert });
}
