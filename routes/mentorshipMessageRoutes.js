import express from "express";
import {
  protect,
  volunteerOnly,
  alumniOnly,
} from "../middleware/authMiddleware.js";

import {
  getStudentMessages,
  sendStudentMessage,
  getAlumniMessages,
  sendAlumniMessage,
  getAllMentorships,
} from "../controllers/mentorshipMessageController.js";

const mentorshipMessage = express.Router();

/* =====================================================
   STUDENT / VOLUNTEER CHAT (PRIVATE)
===================================================== */
mentorshipMessage.get(
  "/studentchat/:mentorshipId",
  protect,
  volunteerOnly,
  getStudentMessages
);

mentorshipMessage.post(
  "/studentchat/:mentorshipId",
  protect,
  volunteerOnly,
  sendStudentMessage
);

/* =====================================================
   ALUMNI CHAT (PRIVATE)
===================================================== */
mentorshipMessage.get(
  "/alumnichat/:mentorshipId",
  protect,
  alumniOnly,
  getAlumniMessages
);

mentorshipMessage.post(
  "/alumnichat/:mentorshipId",
  protect,
  alumniOnly,
  sendAlumniMessage
);

mentorshipMessage.get("/allalumni",protect,alumniOnly,getAllMentorships)
mentorshipMessage.get("/allstudent",protect,volunteerOnly,getAllMentorships)

export default mentorshipMessage;
