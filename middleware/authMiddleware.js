import jwt from "jsonwebtoken";
import Admin from "../models/Admin.js";
import Alumni from "../models/Alumni.js";
import Student from "../models/Student.js";
import Teacher from "../models/Teacher.js";
import Coordinator from "../models/Coordinator.js";

const MODEL_BY_ROLE = {
  admin: Admin,
  superadmin: Admin,
  alumni: Alumni,
  student: Student,
  volunteer: Student,
  teacher: Teacher,
  coordinator: Coordinator,
};

const attach = (req, user) => {
  if (user instanceof Admin) req.admin = user;
  else if (user instanceof Alumni) req.alumni = user;
  else if (user instanceof Student) req.student = user;
  else if (user instanceof Teacher) req.teacher = user;
  else if (user instanceof Coordinator) req.coordinator = user;

  req.user = req.admin || req.alumni || req.student || req.teacher || req.coordinator;
  if (req.user) {
    req.user.role =
      req.admin?.role ||
      (req.alumni ? "alumni" : null) ||
      (req.student ? req.student.role : null) ||
      (req.teacher ? "teacher" : null) ||
      (req.coordinator ? "coordinator" : null);
  }
};

// Protect middleware for all user types.
export const protect = async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer")) {
    return res.status(401).json({ message: "Not authorized, no token" });
  }

  try {
    const token = header.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    let user = null;
    const Model = decoded.role && MODEL_BY_ROLE[decoded.role];

    if (Model) {
      // Single lookup: the token already says which collection to check.
      user = await Model.findById(decoded.id).select("-password");
    } else {
      // Tokens issued before role was included in the payload (still valid
      // for up to 7 days after that change ships) don't carry a role, so
      // fall back to checking every collection.
      user =
        (await Admin.findById(decoded.id).select("-password")) ||
        (await Alumni.findById(decoded.id).select("-password")) ||
        (await Student.findById(decoded.id).select("-password")) ||
        (await Teacher.findById(decoded.id).select("-password")) ||
        (await Coordinator.findById(decoded.id).select("-password"));
    }

    if (!user) {
      return res.status(401).json({ message: "Not authorized, user not found" });
    }

    attach(req, user);
    next();
  } catch (error) {
    return res.status(401).json({ message: "Not authorized, token failed" });
  }
};

// Super Admin only access
export const superAdminOnly = (req, res, next) => {
  if (!req.admin) {
    return res.status(401).json({ message: "Not authorized, no user" });
  }
  if (req.admin.role !== "superadmin") {
    return res.status(403).json({ message: "Access denied, Superadmin only" });
  }
  next();
};

//  Admin (and Superadmin) access only
export const adminOnly = (req, res, next) => {
  if (!req.admin) {
    return res.status(401).json({ message: "Not authorized, admin not found" });
  }
  if (req.admin.role !== "admin" && req.admin.role !== "superadmin") {
    return res.status(403).json({ message: "Access denied, admin only" });
  }
  next();
};

// teacher only
export const teacherOnly = (req, res, next) => {
  if (!req.teacher) {
    return res.status(403).json({ message: "Access denied, Teachers only" });
  }
  next();
};

// Volunteer only
export const volunteerOnly = (req, res, next) => {
  if (!req.student || req.student.role !== "volunteer") {
    return res.status(403).json({ message: "Access denied, Volunteers only" });
  }
  next();
};

// Coordinator only
export const coordinatorOnly = (req, res, next) => {
  if (!req.coordinator) {
    return res.status(403).json({ message: "Access denied, Coordinators only" });
  }
  next();
};

// Alumni only
export const alumniOnly = (req, res, next) => {
  if (!req.alumni) {
    return res.status(403).json({ message: "Access denied, Alumni only" });
  }
  next();
};
