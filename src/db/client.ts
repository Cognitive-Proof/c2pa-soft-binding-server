import {
  type Document,
  type Filter,
  MongoClient,
  type OptionalUnlessRequiredId,
  type UpdateFilter,
} from "mongodb";
import { env } from "../env";

const uri = env.MONGO_DB_URI;

const globalForMongo = globalThis as unknown as {
  mongoClient?: MongoClient;
  mongoClientPromise?: Promise<MongoClient>;
};

export const mongoClient = globalForMongo.mongoClient ?? new MongoClient(uri);

const clientPromise =
  globalForMongo.mongoClientPromise ?? mongoClient.connect();

if (env.NODE_ENV !== "production") {
  globalForMongo.mongoClient = mongoClient;
  globalForMongo.mongoClientPromise = clientPromise;
}

export async function getMongoClient() {
  return clientPromise;
}

export async function getCollection<T extends Document>(
  collectionName: string,
) {
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
  const updateDoc = (
    "$set" in update ? update : { $set: update }
  ) as UpdateFilter<T>;
  return collection.updateOne(filter, updateDoc, { upsert });
}
