// import jwt from "jsonwebtoken";
// import Admin from "../models/Admin.js";
// import Alumni from "../models/Alumni.js";
// import Student from "../models/Student.js";

// export const protect = async (req, res, next) => {
//   let token;
//   //token starts with bearer
//   if (
//     req.headers.authorization &&
//     req.headers.authorization.startsWith("Bearer")
//   ) {
//     try {
//       token = req.headers.authorization.split(" ")[1];
//       //check both the jwt code and token then verify
//       const decoded = jwt.verify(token, process.env.JWT_SECRET);
//       //take user from db and exclude password
//       req.admin = await Admin.findById(decoded.id).select("-password");
//       next();
//     } catch (error) {
//       return res.status(401).json({ message: "Not authorized ,token failed" });
//     }
//   }

//   if (!token) {
//     return res.status(401).json({ message: "Not authorised and no token" });
//   }
// };

// // for superadmin

// export const superAdminOnly = (req, res, next) => {
//   if (!req.admin) {
//     return res.status(401).json({ message: "Not authorised,no user" });
//   }

//   if (req.admin.role != "superadmin") {
//     return res.status(403).json({ message: "Access denied,Superadmin only" });
//   }
//   next();
// };

// 2nd version

// // export const protect = async (req, res, next) => {
// //   let token;

// //   if (
// //     req.headers.authorization &&
// //     req.headers.authorization.startsWith("Bearer")
// //   ) {
// //     try {
// //       token = req.headers.authorization.split(" ")[1];

// //       // Verify token
// //       const decoded = jwt.verify(token, process.env.JWT_SECRET);

// //       let user = null;

// //       if (decoded.role === "admin" || decoded.role === "superadmin") {
// //         user = await Admin.findById(decoded.id).select("-password");
// //         req.admin = user;
// //       } else if (decoded.role === "alumni") {
// //         user = await Alumni.findById(decoded.id).select("-password");
// //         req.alumni = user;
// //       } else if (decoded.role === "student") {
// //         user = await Student.findById(decoded.id).select("-password");
// //         req.student = user;
// //       }

// //       if (!user) {
// //         return res.status(401).json({ message: "Not authorized, user not found" });
// //       }

// //       return next();
// //     } catch (error) {
// //       return res.status(401).json({ message: "Not authorized, token failed" });
// //     }
// //   }

// //   return res.status(401).json({ message: "Not authorized, no token" });
// // };

// // export const superAdminOnly = (req, res, next) => {
// //   if (!req.admin) {
// //     return res.status(401).json({ message: "Not authorized, no user" });
// //   }

// //   if (req.admin.role !== "superadmin") {
// //     return res.status(403).json({ message: "Access denied, Superadmin only" });
// //   }

// //   next();
// // };

// // //  Admin (and superadmin) access only
// // export const adminOnly = (req, res, next) => {
// //   if (!req.admin) {
// //     return res.status(401).json({ message: "Not authorized, admin not found" });
// //   }

// //   if (req.admin.role !== "admin" && req.admin.role !== "superadmin") {
// //     return res.status(403).json({ message: "Access denied, admin only" });
// //   }

// //   next();
// // };

// 3rd version
import jwt from "jsonwebtoken";
import Admin from "../models/Admin.js";
import Alumni from "../models/Alumni.js";
import Student from "../models/Student.js";
import Teacher from "../models/Teacher.js";
import Coordinator from "../models/Coordinator.js";

//  Protect middleware for all user types
export const protect = async (req, res, next) => {
  let token;

  // Check for Bearer token
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    try {
      token = req.headers.authorization.split(" ")[1];

      // Verify the token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // Your token currently only contains `id`
      // So we’ll find the user by ID across all models
      let user =
        (await Admin.findById(decoded.id).select("-password")) ||
        (await Alumni.findById(decoded.id).select("-password")) ||
        (await Student.findById(decoded.id).select("-password")) ||
        (await Teacher.findById(decoded.id).select("-password")) ||
        (await Coordinator.findById(decoded.id).select("-password"));

      if (!user) {
        return res
          .status(401)
          .json({ message: "Not authorized, user not found" });
      }

      // Attach the user to the request based on type
      if (user instanceof Admin) req.admin = user;
      else if (user instanceof Alumni) req.alumni = user;
      else if (user instanceof Student) req.student = user;
      else if (user instanceof Teacher) req.teacher = user;
      else if (user instanceof Coordinator) req.coordinator = user;

      // chat app
      // attach unified user object for universal use
      req.user =
        req.admin ||
        req.alumni ||
        req.student ||
        req.teacher ||
        req.coordinator;
      if (req.user) {
        req.user.role =
          req.admin?.role ||
          (req.alumni ? "alumni" : null) ||
          (req.student ? req.student.role : null) ||
          (req.teacher ? "teacher" : null) ||
          (req.coordinator ? "coordinator" : null);
      }

      next();
    } catch (error) {
      return res.status(401).json({ message: "Not authorized, token failed" });
    }
  } else {
    return res.status(401).json({ message: "Not authorized, no token" });
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
    return res
      .status(403)
      .json({ message: "Access denied, Coordinators only" });
  }
  next();
};

// Alumni only
export const alumniOnly = (req, res, next) => {
  if (!req.alumni) {
    return res
      .status(403)
      .json({ message: "Access denied, Alumni only" });
  }
  next();
};
