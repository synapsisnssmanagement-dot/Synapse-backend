import express from "express";
import {
  getMessagesForEvent,
  sendMessage,
} from "../controllers/messageController.js";
import {
  coordinatorOnly,
  protect,
  teacherOnly,
  volunteerOnly,
} from "../middleware/authMiddleware.js";

const messagerouter = express.Router();
messagerouter.get("/events/:eventId/messages", getMessagesForEvent);
messagerouter.post("/coordinator/send", protect, coordinatorOnly, sendMessage);
messagerouter.post("/teacher/send", protect, teacherOnly, sendMessage);
messagerouter.post("/student/send", protect, volunteerOnly, sendMessage);
export default messagerouter;
