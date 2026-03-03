import mongoose from "mongoose";

export default async function connectDB(mongoUri: string) {
  if (!mongoUri) throw new Error("Missing MONGO_URI");
  await mongoose.connect(mongoUri);
  console.log("MongoDB connected");
}
