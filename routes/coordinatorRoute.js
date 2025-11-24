import express from "express";
import {
  approveCoordinator,
  assignTeacherToEvent,
  assignVoulnteerToEvent,
  coordinatorSignup,
  createEvent,
  editEvent,
  generateEventReport,
  getAllCoordinators,
  getAllEventsByCoordinator,
  getAllPendingCoordinator,
  getAllStudentsByCoordinator,
  getAllTeachersByCoordinator,
  getAllVolunteers,
  getCoordinatorDashboard,
  getCoordinatorProfile,
  getMyEvents,
  getStudentById,
  getStudentBySkill,
  Login,
  recommendedGraceMark,
  rejectCoordinator,
  rejectInDashboardCoordinator,
  studentToVolunteer,
  toggleDonation,
  unassignTeacherFromEvent,
  unassignVolunteerFromEvent,
  updateCoordinatorProfile,
  updateEventStatus,
  updateStudentByCoordinator,
  verifyOtp,
  volunteerTostudent,
} from "../controllers/coordinatorController.js";
import upload from "../middleware/uploadMiddleware.js";
import {
  coordinatorOnly,
  protect,
  adminOnly,
} from "../middleware/authMiddleware.js";

const coordinatorRoute = express.Router();

coordinatorRoute.post(
  "/coordinatorsignup",
  upload.fields([
    { name: "profileImage", maxCount: 1 },
    { name: "verificationDocument", maxCount: 1 },
  ]),
  coordinatorSignup
);
coordinatorRoute.post("/verifyotp", verifyOtp);
coordinatorRoute.post("/approvecoordinator", approveCoordinator);
coordinatorRoute.post("/logincoordinator", Login);
coordinatorRoute.post(
  "/createevents",
  upload.single("images"),
  protect,
  coordinatorOnly,
  createEvent
);
coordinatorRoute.post(
  "/getstudentbyskill/:skills",
  protect,
  coordinatorOnly,
  getStudentBySkill
);

coordinatorRoute.post(
  "/studenttovolunteer",
  protect,
  coordinatorOnly,
  studentToVolunteer
);
coordinatorRoute.post(
  "/volunteertostudent",
  protect,
  coordinatorOnly,
  volunteerTostudent
);

coordinatorRoute.post(
  "/assignvolunteertoevents",
  protect,
  coordinatorOnly,
  assignVoulnteerToEvent
);

coordinatorRoute.post(
  "/recommendgracemark",
  protect,
  coordinatorOnly,
  recommendedGraceMark
);

//pdf generation
coordinatorRoute.post(
  "/pdfgeneration/:eventId",
  protect,
  coordinatorOnly,
  generateEventReport
);

coordinatorRoute.post(
  "/updateeventstatus",
  protect,
  coordinatorOnly,
  updateEventStatus
);

////////Admin Dashboard/////////////////////////////
coordinatorRoute.get(
  "/getallpendingcoordinator",
  protect,
  adminOnly,
  getAllPendingCoordinator
);

coordinatorRoute.put(
  "/approvecoordinator/:id",
  protect,
  adminOnly,
  approveCoordinator
);

coordinatorRoute.put(
  "/rejectcoordinator/:id",
  protect,
  adminOnly,
  rejectCoordinator
);

coordinatorRoute.get(
  "/getallcoordinator",
  protect,
  adminOnly,
  getAllCoordinators
);

coordinatorRoute.put(
  "/rejectcoordinatorindahboard/:id",
  protect,
  adminOnly,
  rejectInDashboardCoordinator
);

//coordinator Dahboard
coordinatorRoute.get(
  "/coordinatordashboard",
  protect,
  coordinatorOnly,
  getCoordinatorDashboard
);

// managestsudents
coordinatorRoute.get("/students", protect, getAllStudentsByCoordinator);
coordinatorRoute.get("/students/:id", protect, getStudentById);
coordinatorRoute.get(
  "/updatestudents/:id",
  protect,
  updateStudentByCoordinator
);

coordinatorRoute.get("/my-events", protect, coordinatorOnly, getMyEvents);
coordinatorRoute.put(
  "/events/:eventId",
  upload.single("image"),
  protect,
  coordinatorOnly,
  editEvent
);

coordinatorRoute.get(
  "/events",
  protect,
  coordinatorOnly,
  getAllEventsByCoordinator
);
coordinatorRoute.get(
  "/teachers",
  protect,
  coordinatorOnly,
  getAllTeachersByCoordinator
);
coordinatorRoute.post(
  "/assign-teacher",
  protect,
  coordinatorOnly,
  assignTeacherToEvent
);
coordinatorRoute.delete(
  "/unassign-teacher",
  protect,
  coordinatorOnly,
  unassignTeacherFromEvent
);

// Unassign volunteers from event
coordinatorRoute.post(
  "/unassign-volunteers",
  protect,
  coordinatorOnly,
  unassignVolunteerFromEvent
);

// Get all volunteers of institution
coordinatorRoute.get("/volunteers", protect, coordinatorOnly, getAllVolunteers);

coordinatorRoute.get(
  "/profile",
  protect,
  coordinatorOnly,
  getCoordinatorProfile
);

// toggle donation
coordinatorRoute.put("/toggle-donation/:eventId", protect, coordinatorOnly, toggleDonation);

// ✅ Update profile (with optional file upload)
coordinatorRoute.put(
  "/updateProfile",
  protect,
  coordinatorOnly,
  upload.single("profileImage"),
  updateCoordinatorProfile
);
export default coordinatorRoute;
