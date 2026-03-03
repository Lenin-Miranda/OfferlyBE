import dotenv from "dotenv";
import connectDB from "./config/db.js";
import app from "./app.js";

dotenv.config();

const port = Number(process.env.PORT || 4000);

async function start() {
  await connectDB(process.env.MONGO_URI || "");
  app.listen(port, () => {
    console.log(`Server running on ${port}`);
  });
}

start();
