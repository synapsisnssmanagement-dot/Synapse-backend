import jwt from "jsonwebtoken";
import Student from "../models/Student.js";
import Teacher from "../models/Teacher.js";
import Coordinator from "../models/Coordinator.js";
import Alumni from "../models/Alumni.js";
import Admin from "../models/Admin.js";

export const socketAuth = async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (!token) return next(new Error("No token provided"));

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    let user = null;
    // Google sign-in issues "volunteer" for volunteer students; admins have no
    // institution but still need a socket for live notifications.
    if (decoded.role === "student" || decoded.role === "volunteer")
      user = await Student.findById(decoded.id).select("name institution");
    else if (decoded.role === "admin" || decoded.role === "superadmin")
      user = await Admin.findById(decoded.id).select("name");
    else if (decoded.role === "teacher")
      user = await Teacher.findById(decoded.id).select("name institution");
    else if (decoded.role === "coordinator")
      user = await Coordinator.findById(decoded.id).select("name institution");
    else if (decoded.role === "alumni") {
      user = await Alumni.findById(decoded.id).select("name institution");
    }

    if (!user) return next(new Error("User not found"));

    socket.user = {
      id: user._id.toString(),
      name: user.name,
      role: decoded.role === "volunteer" ? "student" : decoded.role,
      institution: user.institution?.toString?.() || "",
    };

    next();
  } catch (err) {
    console.error("Socket authentication failed:", err.message);
    next(new Error("Authentication error"));
  }
};
