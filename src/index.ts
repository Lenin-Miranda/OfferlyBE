import "dotenv/config";
import connectDB from "./config/db.js";
import app from "./app.js";
import { logger } from "./lib/logger.js";

const port = Number(process.env.PORT || 4000);

async function start() {
  try {
    await connectDB(process.env.MONGO_URI || "");
    app.listen(port, () => {
      logger.info("Server running", {
        port,
        nodeEnv: process.env.NODE_ENV || "development",
      });
    });
  } catch (error) {
    logger.error("Failed to start server", { error });
    process.exit(1);
  }
}

start();
