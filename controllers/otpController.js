import Alumni from "../models/Alumni.js";
import Coordinator from "../models/Coordinator.js";
import Student from "../models/Student.js";
import Teacher from "../models/Teacher.js";

export const verifyOtp = async (req, res) => {
  try {
    const { id, otp, role } = req.body;

    // validate request
    if (!id || !otp || !role) {
      return res.status(400).json({
        success: false,
        message: "Missing id, OTP, or role in request",
      });
    }

    // determine model based on role
    let user;
    if (role === "student") {
      user = await Student.findById(id);
    } else if (role === "teacher") {
      user = await Teacher.findById(id);
    } else if (role === "coordinator") {
      user = await Coordinator.findById(id);
    } else if (role === "alumni") {
      user = await Alumni.findById(id);
    } else {
      return res.status(400).json({ success: false, message: "Invalid role" });
    }

    // check if user exists
    if (!user) {
      return res.status(404).json({
        success: false,
        message: `${role.charAt(0).toUpperCase() + role.slice(1)} not found`,
      });
    }

    // check otp validity
    if (user.otp !== Number(otp) || user.otpExpiry < Date.now()) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid or expired OTP" });
    }

    // clear otp data
    user.otp = null;
    user.otpExpiry = null;

    if (role === "teacher") {
      // teacher needs admin approval
      user.status = "pending";
      user.verifiedByAdmin = false;
    } else if (role === "student") {
      // student becomes verified immediately
      user.status = "pending";
    } else if (role === "coordinator") {
      user.status === "pending";
    } else if (role === "alumni") {
      user.status = "pending";
    }

    await user.save();

    return res.status(200).json({
      success: true,
      message:
        role === "teacher"
          ? "OTP verified successfully. Wait for admin approval."
          : "OTP verified successfully! You can now log in.",
    });
  } catch (error) {
    console.error("Error verifying OTP:", error);
    return res
      .status(500)
      .json({ success: false, message: "Server error: " + error.message });
  }
};
