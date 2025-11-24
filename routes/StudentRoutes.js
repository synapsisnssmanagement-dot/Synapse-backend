import express from "express";
import upload from "../middleware/uploadMiddleware.js";
import {
  adminCreateStudent,
  approvePendingStudent,
  approveStudent,
  deleteStudent,
  editStudentProfile,
  generateAICertificate,
  generateOwnCertificate,
  getAllStudents,
  getFilteredStudentEvents,
  getMyEvents,
  getPendingStudent,
  getStudentAttendanceForEvent,
  getStudentDashboard,
  getStudentEvents,
  getStudentProfile,
  rejectInDashboardStudent,
  rejectStudent,
  removeStudentFromEvent,
  studentLogin,
  studentSignUp,
  studentUpdate,
  uploadEventImages,
  verifyOtp,
} from "../controllers/studentController.js";
import {
  adminOnly,
  protect,
  volunteerOnly,
} from "../middleware/authMiddleware.js";

const studentRouter = express.Router();

studentRouter.post(
  "/studentsignup",
  upload.single("profileImage"),
  studentSignUp
);
studentRouter.post("/student-verify-otp", verifyOtp);
studentRouter.post("/studentlogin", studentLogin);

studentRouter.post(
  "/admin-student-create",
  upload.single("profileImage"),
  adminCreateStudent
);
studentRouter.put("/approve-student/:id", approveStudent);

// profile
studentRouter.put(
  "/update-student/:id",
  upload.single("profileImage"),
  studentUpdate
);
studentRouter.delete("/delete-student/:id", deleteStudent);

// events
studentRouter.get("/student-events/:id", getStudentEvents);
studentRouter.delete(
  "/remove-student-event/:studentId/:eventId",
  removeStudentFromEvent
);

// studentRouter.get(
//   "/eventcerificate/:eventId",
//   protect,
//   volunteerOnly,
//   generateOwnCertificate
// );

//dashboard(admin)
studentRouter.get(
  "/getallpendingstudent",
  protect,
  adminOnly,
  getPendingStudent
);
studentRouter.put(
  "/approvependingstudent/:id",
  protect,
  adminOnly,
  approvePendingStudent
);
studentRouter.put("/rejectstuedent/:id", protect, adminOnly, rejectStudent);

studentRouter.get("/getallstudent", protect, adminOnly, getAllStudents);

studentRouter.put(
  "/rejectinallstudent/:id",
  protect,
  adminOnly,
  rejectInDashboardStudent
);

studentRouter.get("/dashboard", protect, volunteerOnly, getStudentDashboard);

studentRouter.get("/profile", protect, volunteerOnly, getStudentProfile);

studentRouter.put(
  "/profile/edit",
  protect,
  volunteerOnly,
  upload.single("profileImage"),
  editStudentProfile
);

studentRouter.get(
  "/events/filter",
  protect,
  volunteerOnly,
  getFilteredStudentEvents
);

studentRouter.get("/my-events", protect, volunteerOnly, getMyEvents);

studentRouter.get(
  "/generate/:eventId",
  protect,
  volunteerOnly,
  generateAICertificate
);

studentRouter.get(
  "/event/:eventId/attendance",
  protect,
  volunteerOnly,
  getStudentAttendanceForEvent
);

studentRouter.post(
  "/:id/uploadimagesbystudent",
  upload.array("images", 10),
  protect,
  volunteerOnly,
  uploadEventImages
);

export default studentRouter;
