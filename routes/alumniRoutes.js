// import express from "express";
// import {
//   addAchievement,
//   addTestimonial,
//   approveAlumni,
//   deleteAlumni,
//   Login,
//   Signup,
//   updateAlumni,
//   verifyOtp,
//   updateTestimonialVisibility,
//   getTopTestimonial,
// } from "../controllers/alumniController.js";
// import { protect, superAdminOnly } from "../middleware/authMiddleware.js";
// import upload from "../middleware/uploadMiddleware.js";

// const alumniRouter = express.Router();

// alumniRouter.post("/alumnisignup", upload.single("profileImage"), Signup);
// alumniRouter.post("/verifyotp/:id", verifyOtp);
// alumniRouter.post("/login", Login);

// // admin approval
// alumniRouter.put("/alumniapproval/:id", protect, approveAlumni);
// alumniRouter.put(
//   "/updatealumni/:id",
//   protect,
//   upload.single("profileImage"),
//   updateAlumni
// );
// alumniRouter.delete("/delete/:id", protect, deleteAlumni);

// // alumni achievement and testimonial adding
// alumniRouter.post("/:id/addalumniachievement", protect, addTestimonial);
// alumniRouter.post("/:id/addachievement", protect, addAchievement);

// // Admin approves/rejects testimonial
// alumniRouter.put(
//   "/:id/:testimonialId",
//   protect,
//   superAdminOnly,
//   updateTestimonialVisibility
// );

// // Public - get top 3 approved testimonials
// alumniRouter.get("/top/all", getTopTestimonial);

// export default alumniRouter;

import express from "express";
import {
  // Signup,
  // verifyOtp,
  loginAlumni,
  // approveAlumni,
  // updateAlumni,
  // deleteAlumni,
  addTestimonial,
  // addAchievement,
  updateTestimonialVisibility,
  // getTopTestimonials,
  signupAlumni,
  getTopTestimonials,
  getAllAlumnis,
  getAllPendingAlumni,
  approveAlumni,
  rejectAlumni,
  rejectInDashboardAlumni,
  getAlumniDashboard,
  getAlumniProfile,
  updateAlumniProfile,
  getAllTestimonials,
  getAllImages,
} from "../controllers/alumniController.js";
import {
  adminOnly,
  alumniOnly,
  protect,
  superAdminOnly,
} from "../middleware/authMiddleware.js";
import upload from "../middleware/uploadMiddleware.js";
import { getAllEventsAlumniInstituition } from "../controllers/eventController.js";

const alumniRouter = express.Router();

/* ===========================
        AUTHENTICATION
   =========================== */
alumniRouter.post("/signup", upload.single("profileImage"), signupAlumni);
// alumniRouter.post("/verify-otp/:id", verifyOtp);
alumniRouter.post("/login", loginAlumni);

/* ===========================
        ADMIN ACTIONS
   =========================== */
// alumniRouter.put("/approve/:id", protect, superAdminOnly, approveAlumni);
// alumniRouter.delete("/delete/:id", protect, superAdminOnly, deleteAlumni);
// alumniRouter.put(
//   "/update/:id",
//   protect,
//   upload.single("profileImage"),
//   updateAlumni
// );

/* ===========================
        TESTIMONIALS
   =========================== */
// Alumni adds testimonial
alumniRouter.post("/testimonial", protect, alumniOnly, addTestimonial);

// Admin updates visibility (approve/reject)
alumniRouter.put(
  "/:id/testimonial/:testimonialId/visibility",
  protect,
  superAdminOnly,
  updateTestimonialVisibility
);

// Public route — get top 3 approved testimonials
alumniRouter.get("/testimonials/top", getTopTestimonials);

/* ===========================
        ACHIEVEMENTS
   =========================== */
// alumniRouter.post("/:id/achievement", protect, addAchievement);

// admin action
alumniRouter.get("/", protect, adminOnly, getAllAlumnis);
alumniRouter.get("/pending", protect, adminOnly, getAllPendingAlumni);
alumniRouter.put("/approve/:id", protect, adminOnly, approveAlumni);
alumniRouter.put("/reject/:id", protect, adminOnly, rejectAlumni);
alumniRouter.put(
  "/reject-dashboard/:id",
  protect,
  adminOnly,
  rejectInDashboardAlumni
);

alumniRouter.get("/dashboard", protect, alumniOnly, getAlumniDashboard);

alumniRouter.get("/getalleventsalumniinstituition", protect, alumniOnly,getAllEventsAlumniInstituition );

// Alumni Profile
alumniRouter.get("/profile", protect, alumniOnly, getAlumniProfile);
alumniRouter.put(
  "/profile",
  protect,
  alumniOnly,
  upload.single("profileImage"),
  updateAlumniProfile
);

alumniRouter.get("/allinstituteimages",protect,alumniOnly,getAllImages)

alumniRouter.get("/testimonials", protect, superAdminOnly, getAllTestimonials);

export default alumniRouter;
