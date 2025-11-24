import express from "express";
import { generateAIInsight, generateEventSummary } from "../controllers/aiController.js";
import { protect, coordinatorOnly } from "../middleware/authMiddleware.js";

const airouter = express.Router();

airouter.post(
  "/generatesummary",
  protect,
  coordinatorOnly,
  generateEventSummary
);

airouter.post("/generate", generateAIInsight);

export default airouter;
