import express from "express";
import { verifyOtp } from "../controllers/otpController.js";

const otpRouter = express.Router();

// universal otp route for all roles
otpRouter.post("/verify-otp", verifyOtp);

export default otpRouter;
