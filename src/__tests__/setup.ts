import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

let isConnected = false;
let mongoServer: MongoMemoryServer | null = null;

export async function connectTestDB() {
  if (isConnected) return;

  mongoServer ??= await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  isConnected = true;
}

export async function closeTestDb() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.dropDatabase();
    await mongoose.connection.close();
  }

  if (mongoServer) {
    await mongoServer.stop();
    mongoServer = null;
  }

  isConnected = false;
}

export async function clearDatabase() {
  if (mongoose.connection.readyState !== 0) {
    const collections = mongoose.connection.collections;
    const promises = [];
    for (const key in collections) {
      if (collections[key]) {
        promises.push(collections[key].deleteMany({}));
      }
    }
    await Promise.all(promises);
  }
}
