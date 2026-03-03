import mongoose from "mongoose";

let isConnected = false;

export async function connectTestDB() {
  if (isConnected) return;

  const uri =
    process.env.MONGO_URI || "mongodb://localhost:27017/offerly_test_db";
  await mongoose.connect(uri);
  isConnected = true;
}

export async function closeTestDb() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.dropDatabase();
    await mongoose.connection.close();
    isConnected = false;
  }
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
