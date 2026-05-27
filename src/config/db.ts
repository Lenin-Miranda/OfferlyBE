import mongoose from "mongoose";
import { logger } from "../lib/logger.js";

export default async function connectDB(mongoUri: string) {
  if (!mongoUri) throw new Error("Missing MONGO_URI");
  await mongoose.connect(mongoUri);
  logger.info("MongoDB connected");
}
