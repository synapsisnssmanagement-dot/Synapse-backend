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
// Event chat is private to the event's institution (was previously unauthenticated).
messagerouter.get("/events/:eventId/messages", protect, getMessagesForEvent);
messagerouter.post("/coordinator/send", protect, coordinatorOnly, sendMessage);
messagerouter.post("/teacher/send", protect, teacherOnly, sendMessage);
messagerouter.post("/student/send", protect, volunteerOnly, sendMessage);
export default messagerouter;
