import express from "express";
import {
  requestMentorship,
  getMentorRequests,
  getStudentMentorships,
  respondToRequest,
  startSession,
  endSession,
  addMenteeFeedback,
  updateMeetingLink,
  getAvailableMentors,
  getAllMenteeFeedback,
} from "../controllers/mentorshipController.js";
import {
  alumniOnly,
  protect,
  volunteerOnly,
} from "../middleware/authMiddleware.js";

const mentorshipRouter = express.Router();

// -------- STUDENT --------
mentorshipRouter.post("/request", protect, volunteerOnly, requestMentorship);
mentorshipRouter.get("/student", protect, volunteerOnly, getStudentMentorships);
mentorshipRouter.get("/mentors", protect, volunteerOnly, getAvailableMentors);

// -------- MENTOR --------
mentorshipRouter.get("/mentor", protect, alumniOnly, getMentorRequests);
mentorshipRouter.put(
  "/:mentorshipId/respond",
  protect,
  alumniOnly,
  respondToRequest
);
mentorshipRouter.put("/:mentorshipId/start", protect, alumniOnly, startSession);
mentorshipRouter.put("/:mentorshipId/end", protect, alumniOnly, endSession);
mentorshipRouter.put(
  "/:mentorshipId/meeting-link",
  protect,
  alumniOnly,
  updateMeetingLink
);

// -------- STUDENT FEEDBACK --------
mentorshipRouter.put(
  "/:mentorshipId/feedback",
  protect,
  volunteerOnly,
  addMenteeFeedback
);

mentorshipRouter.get(
  "/mentee-feedback/all",
  protect,
  alumniOnly,
  getAllMenteeFeedback
);

export default mentorshipRouter;
