import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

const atlasDb = process.env.MONGODB_URL;

export async function ConnectDb() {
  try {
    const db = await mongoose.connect(atlasDb);
    console.log("MongoDb atlas connected");
    return db;
  } catch (error) {
    console.log("failed to connect MongoDb atlas:", error.message);
    throw error;
  }
}
