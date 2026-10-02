import express from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import {
  addCampDiary,
  annualReport,
  getCamp,
  getEligibility,
  getLiveEvent,
  getMyEligibility,
  getPublicImpact,
  listCommunityRequests,
  matchVolunteers,
  saveCampDay,
  setImpact,
  submitCommunityRequest,
  updateCommunityRequest,
  updateEventExtras,
} from "../controllers/nssController.js";
import { coordinatorOnly, protect, volunteerOnly } from "../middleware/authMiddleware.js";

const router = express.Router();

const coordinatorOrTeacher = (req, res, next) =>
  req.coordinator || req.teacher ? next() : res.status(403).json({ success: false, message: "Coordinators and teachers only" });
const campViewer = (req, res, next) =>
  req.coordinator || req.teacher || req.student ? next() : res.status(403).json({ success: false, message: "Not allowed" });

// The public request form is unauthenticated, so cap it per IP.
const requestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  keyGenerator: (req, res) => ipKeyGenerator(req, res),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { message: "Too many requests from this network. Please try again in an hour." },
});

// Public
router.post("/public/requests", requestLimiter, submitCommunityRequest);
router.get("/public/impact/:institutionId", getPublicImpact);

// Students
router.get("/me/eligibility", protect, volunteerOnly, getMyEligibility);

// Coordinators
router.get("/eligibility", protect, coordinatorOnly, getEligibility);
router.get("/events/:eventId/match", protect, coordinatorOnly, matchVolunteers);
router.put("/events/:eventId/extras", protect, coordinatorOnly, updateEventExtras);
router.put("/events/:eventId/impact", protect, coordinatorOnly, setImpact);
router.get("/annual-report", protect, coordinatorOnly, annualReport);
router.get("/requests", protect, coordinatorOnly, listCommunityRequests);
router.put("/requests/:id", protect, coordinatorOnly, updateCommunityRequest);

// Coordinators and teachers run the event on the day
router.get("/events/:eventId/live", protect, coordinatorOrTeacher, getLiveEvent);
router.put("/events/:eventId/camp-day", protect, coordinatorOrTeacher, saveCampDay);
router.post("/events/:eventId/diary", protect, coordinatorOrTeacher, addCampDiary);
router.get("/events/:eventId/camp", protect, campViewer, getCamp);

export default router;
