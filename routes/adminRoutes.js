import express from "express";
import passport from "passport";
import {
  signUp,
  verifyOTP,
  login,
  googleCallback,
  createAdminBySuperadmin,
  updateAdmin,
  deleteAdmin,
  getDashboardStat,
  getAdminProfile,
  updateAdminProfile,
} from "../controllers/adminController.js";
import {
  adminOnly,
  protect,
  superAdminOnly,
} from "../middleware/authMiddleware.js";

const router = express.Router();

// Auth
router.post("/signup", signUp);
router.post("/verify-otp", verifyOTP);
router.post("/login", login);
router.put("/updateadmin/:id", protect, updateAdmin);
router.delete("/deleteadmin/:id", protect, superAdminOnly, deleteAdmin);

// dashboard data
router.get("/dashboardata", protect, adminOnly, getDashboardStat);

// // Step 1: Google login
// router.get(
//   "/google",
//   passport.authenticate("google", { scope: ["profile", "email"] })
// );

// // Step 2: Google callback
// router.get(
//   "/google/callback",
//   passport.authenticate("google", { failureRedirect: "http://localhost:5173/?error=User%20not%20registered" }),
//   // googleCallback
//   // if success then
//   (req, res) => {
//     res.redirect("http://localhost:5173/dashboard");
//   }
// );
// Superadmin only
router.post("/create-admin", protect, superAdminOnly, createAdminBySuperadmin);
router.get("/profile", protect, getAdminProfile);
router.put("/profile", protect, updateAdminProfile);

export default router;
