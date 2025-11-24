import express from "express";
import {
  assignTeacherToEvent,
  teacherLogin,
  teacherSignUp,
  verifyOtp,
  markAttendance,
  assignGraceMark,
  generateAttendancePdf,
  approveRecommendedGraceMark,
  rejectPendingTeacher,
  getAllPendingTeacher,
  approveTeacher,
  getAllTeacher,
  rejectInDashboardTeacher,
  // teacherOverview,
  // getTeacherDashboard,
  teacherOverview,
  getPendingRecommendations,
  getMyEvents,
  uploadEventImages,
  editEvent,
  updateGraceMark,
  deleteGraceMark,
  getTeacherProfile,
  updateTeacherProfile,
  getParticipantsOfEvent,
} from "../controllers/teacherController.js";
import upload from "../middleware/uploadMiddleware.js";
import {
  adminOnly,
  coordinatorOnly,
  protect,
  teacherOnly,
} from "../middleware/authMiddleware.js";
import { approvePendingStudent } from "../controllers/studentController.js";

const teacherRoute = express.Router();

teacherRoute.post(
  "/signup",
  upload.fields([
    { name: "profileImage", maxCount: 1 },
    { name: "verificationDocument", maxCount: 1 },
  ]),
  teacherSignUp
);
teacherRoute.post("/verify-otp", verifyOtp);
teacherRoute.post("/login", teacherLogin);

// Admin actions
teacherRoute.post("/assign-event", protect, adminOnly, assignTeacherToEvent);

// Attendance
teacherRoute.post("/attendance/:eventId", protect, teacherOnly, markAttendance);
teacherRoute.get(
  "/attendance/pdf/:eventId",
  protect,
  teacherOnly,
  generateAttendancePdf
);

// Grace marks
teacherRoute.post("/grace-marks", protect, teacherOnly, assignGraceMark);

// gracemark update
// teacherRoute.put("/grace-marks/:studentId", updateGraceMark);
teacherRoute.put("/update/:studentId/:eventId", updateGraceMark);

// grace mark delete
// teacherRoute.delete("/grace-marks/:studentId", deleteGraceMark);
teacherRoute.delete("/delete/:studentId/:eventId", deleteGraceMark);


teacherRoute.get(
  "/participantsofevents/:eventId",
  protect,
  teacherOnly,
  getParticipantsOfEvent
);



// recommended gracemark approve
teacherRoute.put(
  "/approverecommendedgracemark",
  protect,
  teacherOnly,
  approveRecommendedGraceMark
);

// admin operation
teacherRoute.get("/pendingteacher", protect, adminOnly, getAllPendingTeacher);

teacherRoute.put(
  "/approvependingteacher/:id",
  protect,
  adminOnly,
  approveTeacher
);

teacherRoute.put(
  "/rejectpendingteacher/:id",
  protect,
  adminOnly,
  rejectPendingTeacher
);

teacherRoute.get("/getallteacher", protect, adminOnly, getAllTeacher);
teacherRoute.put(
  "/rejectteacherindashboard/:id",
  protect,
  adminOnly,
  rejectInDashboardTeacher
);

teacherRoute.get("/overview", protect, teacherOnly, teacherOverview);

teacherRoute.get(
  "/pending-recommendations",
  protect,
  teacherOnly,
  getPendingRecommendations
);

teacherRoute.get("/teachermyevents", protect, teacherOnly, getMyEvents);

// Image upload route
teacherRoute.post(
  "/:id/uploadimages",
  upload.array("images", 10),
  protect,
  teacherOnly,
  uploadEventImages
);

teacherRoute.get("/profile", protect, teacherOnly, getTeacherProfile);
teacherRoute.put(
  "/profile",
  protect,
  teacherOnly,
  upload.single("profileImage"),
  updateTeacherProfile
);

// Edit event route
teacherRoute.put("/:id/edit", protect, teacherOnly, editEvent);

export default teacherRoute;
