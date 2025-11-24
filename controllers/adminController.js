import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import nodemailer from "nodemailer";
import { sendEmail } from "../utils/sendEmail.js";
import Admin from "../models/Admin.js";
import { generatePassword } from "../utils/passwordGenerator.js";
import Student from "../models/Student.js";
import Event from "../models/Event.js";
import Teacher from "../models/Teacher.js";
import Coordinator from "../models/Coordinator.js";
import Alumni from "../models/Alumni.js";

// regex
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const passwordRegex =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;

// token genration
const generateToken = (id) => {
  // three part id,token and expire
  return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: "7d" });
};

// otp genration
const otpGeneration = () => {
  return Math.floor(100000 + Math.random() * 900000);
};

// signup
export const signUp = async (req, res) => {
  try {
    const { name, email, password, phoneNumber, department } = req.body;
    // validation
    if (!emailRegex.test(email)) {
      return res
        .status(400)
        .json({ success: false, message: "invalid email format" });
    }
    if (!passwordRegex.test(password)) {
      return res.status(400).json({
        success: false,
        message:
          "Password must be 8+ chars, include uppercase, lowercase, number, special characters",
      });
    }

    const isExist = await Admin.findOne({ email });
    if (isExist) {
      return res
        .status(400)
        .json({ success: false, message: "email already exist" });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const otp = otpGeneration();
    const otpExpiry = Date.now() + 5 * 60 * 1000;
    // admin data creation
    const admin = await Admin.create({
      name,
      email,
      department,
      password: hashedPassword,
      otp,
      phoneNumber,
      otpExpiry,
      status: "pending",
    });
    // otp genrate
    await sendEmail(email, otp);
    res.status(201).json({
      success: true,
      message: "OTP sent to email",
      adminId: admin._id,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// update admin and super admin
export const updateAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // prevent from changing status and role
    if (req.admin.role !== "superadmin") {
      delete updates.role;
      delete updates.status;
    }

    // password updation and hash
    if (updates.password) {
      updates.password = await bcrypt.hash(updates.password, 10);
    }

    const admin = await Admin.findByIdAndUpdate(id, updates, {
      // will give the updated one as well else it showly updated succesfull and boolean true
      new: true,
      runValidators: true,
    }).select("-password");

    if (!admin) {
      return res
        .status(404)
        .json({ success: true, message: "Admin not found" });
    }

    res.json({ success: true, message: "Admin updated sucessfully", admin });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// delete admin
export const deleteAdmin = async (req, res) => {
  try {
    const { id } = req.params;

    const admin = await Admin.findByIdAndDelete(id);
    if (!admin) {
      return res
        .status(404)
        .json({ success: false, message: "Admin not found" });
    }
    res.json({ success: true, message: "Admin updated successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// otp verify
export const verifyOTP = async (req, res) => {
  try {
    const { adminId, otp } = req.body;
    const admin = await Admin.findById(adminId);

    if (!admin) {
      return res
        .status(404)
        .json({ success: false, message: "Admin not found" });
    }
    if (admin.otp !== Number(otp) || admin.otpExpiry < Date.now()) {
      return res.status(400).json({ messgae: "invalid otp or expired otp" });
    }

    admin.status = "active";
    admin.otp = null;
    admin.otpExpiry = null;
    await admin.save();

    const token = generateToken(admin._id);
    res
      .status(201)
      .json({ success: true, message: "successfully verified", token, admin });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Login
export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const admin = await Admin.findOne({ email });
    if (!admin)
      return res
        .status(404)
        .json({ success: false, message: "Admin not found" });

    // verified or not
    if (admin.status !== "active") {
      return res
        .status(403)
        .json({ success: false, message: "Account not verified" });
    }

    // match password
    const comparePassword = await bcrypt.compare(password, admin.password);
    if (!comparePassword)
      return res
        .status(400)
        .json({ success: false, message: "Invalid credentials" });

    const token = generateToken(admin._id);

    res.status(200).json({
      success: true,
      message: "Login successful",
      token,
      admin,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// google callback
export const googleCallback = async (req, res) => {
  try {
    const admin = req.user;
    if (!admin) {
      return res.status(404).json({ message: "google auth failed" });
    }

    if (admin.status === "pending") {
      admin.status = "active";
      await admin.save();
    }

    const token = generateToken(admin._id);
    res.json({ message: "Google login success", token, admin });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// super admin
export const createAdminBySuperadmin = async (req, res) => {
  try {
    const { name, email, phoneNumber, department, role } = req.body;

    const exists = await Admin.findOne({ email });
    if (exists)
      return res.status(400).json({ message: "Email already exists" });

    const rawPassword = generatePassword();
    const hashedPassword = await bcrypt.hash(rawPassword, 10);

    const admin = await Admin.create({
      name,
      email,
      phoneNumber,
      department,
      role,
      password: hashedPassword,
      status: "active",
    });

    await sendEmail(
      email,
      "Your NSS Admin Account",
      `Your account has been created. Temporary password: ${rawPassword}`
    );

    res.status(201).json({ message: "Admin created by superadmin", admin });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Dashboard
// export const getDashboardStat = async (req, res) => {
//   try {
//     // students
//     const totalStudents = await Student.countDocuments({ role: "student" });
//     const activeStudent = await Student.countDocuments({ status: "active" });
//     const pendingStudent = await Student.countDocuments({ status: "pending" });
//     const totalVolunteer = await Student.countDocuments({ role: "volunteer" });
//     const departmentStats = await Student.aggregate([
//       { $group: { _id: "$department", count: { $sum: 1 } } },
//       { $sort: { count: -1 } },
//     ]);

//     // Teachers
//     const totalTeachers = await Teacher.countDocuments();
//     const activeTeacher = await Teacher.countDocuments({ status: "active" });
//     const pendingTeachers = await Teacher.countDocuments({ status: "pending" });

//     // coordinators
//     const totalCoordinator = await Coordinator.countDocuments();
//     const activeCoordinators = await Coordinator.countDocuments({
//       status: "active",
//     });
//     const pendingCoordinators = await Coordinator.countDocuments({
//       status: "pending",
//     });

//     // Alumni
//     const totalAlumni = await Alumni.countDocuments();
//     const activeAlumni = await Alumni.countDocuments({ status: "active" });
//     const pendingAlumnis = await Alumni.countDocuments({ status: "pending" });

//     // admins
//     const totalAdmin = await Admin.countDocuments();

//     // events
//     const totalEvents = await Event.countDocuments();
//     const totalCompletedEvent = await Event.countDocuments({
//       status: "Completed",
//     });
//     const upcomingEvents = await Event.countDocuments({ status: "Upcoming" });

//     res.json({
//       success: true,
//       Data: {
//         student: {
//           total: totalStudents,
//           active: activeStudent,
//           pending: pendingStudent,
//           volunteer: totalVolunteer,
//           bydepartment: departmentStats,
//         },
//         event: {
//           total: totalEvents,
//           completed: totalCompletedEvent,
//           upcoming: upcomingEvents,
//         },
//         teacher: {
//           total: totalTeachers,
//           active: activeTeacher,
//           pending: pendingTeachers,
//         },
//         coordinator: {
//           total: totalCoordinator,
//           active: activeCoordinators,
//           pending: pendingCoordinators,
//         },
//         alumni: {
//           total: totalAlumni,
//           active: activeAlumni,
//           pending: pendingAlumnis,
//         },
//         admin: {
//           total: totalAdmin,
//         },
//       },
//     });
//   } catch (error) {
//     res.status(500).json({ success: false, message: error.message });
//   }
// };


export const getDashboardStat = async (req, res) => {
  try {
    // ======= Date Setup =======
    const today = new Date();
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(today.getDate() - 6);

    // utility to fill missing days with 0
    const fillMissingDays = (data) => {
      const filled = [];
      for (let i = 0; i < 7; i++) {
        const date = new Date(sevenDaysAgo);
        date.setDate(sevenDaysAgo.getDate() + i);
        const formatted = date.toISOString().split("T")[0];
        const found = data.find((d) => d._id === formatted);
        filled.push({ date: formatted, count: found ? found.count : 0 });
      }
      return filled;
    };

    // ======= Students =======
    const totalStudents = await Student.countDocuments({ role: "student" });
    const activeStudent = await Student.countDocuments({ status: "active" });
    const pendingStudent = await Student.countDocuments({ status: "pending" });
    const totalVolunteer = await Student.countDocuments({ role: "volunteer" });
    const departmentStats = await Student.aggregate([
      { $group: { _id: "$department", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    // last 7-day student signup trend
    const studentGrowth = await Student.aggregate([
      { $match: { createdAt: { $gte: sevenDaysAgo } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);
    const filledStudentGrowth = fillMissingDays(studentGrowth);

    // ======= Teachers =======
    const totalTeachers = await Teacher.countDocuments();
    const activeTeacher = await Teacher.countDocuments({ status: "active" });
    const pendingTeachers = await Teacher.countDocuments({ status: "pending" });

    const teacherGrowth = await Teacher.aggregate([
      { $match: { createdAt: { $gte: sevenDaysAgo } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);
    const filledTeacherGrowth = fillMissingDays(teacherGrowth);

    // ======= Coordinators =======
    const totalCoordinator = await Coordinator.countDocuments();
    const activeCoordinators = await Coordinator.countDocuments({
      status: "active",
    });
    const pendingCoordinators = await Coordinator.countDocuments({
      status: "pending",
    });

    const coordinatorGrowth = await Coordinator.aggregate([
      { $match: { createdAt: { $gte: sevenDaysAgo } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);
    const filledCoordinatorGrowth = fillMissingDays(coordinatorGrowth);

    // ======= Alumni =======
    const totalAlumni = await Alumni.countDocuments();
    const activeAlumni = await Alumni.countDocuments({ status: "active" });
    const pendingAlumnis = await Alumni.countDocuments({ status: "pending" });

    // ======= Admin =======
    const totalAdmin = await Admin.countDocuments();

    // ======= Events =======
    const totalEvents = await Event.countDocuments();
    const totalCompletedEvent = await Event.countDocuments({
      status: "Completed",
    });
    const upcomingEvents = await Event.countDocuments({ status: "Upcoming" });

    // ======= Response =======
    res.json({
      success: true,
      Data: {
        student: {
          total: totalStudents,
          active: activeStudent,
          pending: pendingStudent,
          volunteer: totalVolunteer,
          bydepartment: departmentStats,
          growth: filledStudentGrowth, 
        },
        teacher: {
          total: totalTeachers,
          active: activeTeacher,
          pending: pendingTeachers,
          growth: filledTeacherGrowth, 
        },
        coordinator: {
          total: totalCoordinator,
          active: activeCoordinators,
          pending: pendingCoordinators,
          growth: filledCoordinatorGrowth, 
        },
        alumni: {
          total: totalAlumni,
          active: activeAlumni,
          pending: pendingAlumnis,
        },
        admin: {
          total: totalAdmin,
        },
        event: {
          total: totalEvents,
          completed: totalCompletedEvent,
          upcoming: upcomingEvents,
        },
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};




// profile
// Get Logged-in Admin Profile
export const getAdminProfile = async (req, res) => {
  try {
    const admin = await Admin.findById(req.admin._id).select("-password");
    if (!admin) {
      return res.status(404).json({ success: false, message: "Admin not found" });
    }
    res.json({ success: true, admin });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Update Logged-in Admin Profile
export const updateAdminProfile = async (req, res) => {
  try {
    const admin = await Admin.findById(req.admin._id);
    if (!admin) {
      return res.status(404).json({ success: false, message: "Admin not found" });
    }

    const { name, email, phoneNumber, department, password } = req.body;

    if (name) admin.name = name;
    if (email) admin.email = email;
    if (phoneNumber) admin.phoneNumber = phoneNumber;
    if (department) admin.department = department;
    if (password) {
      admin.password = await bcrypt.hash(password, 10);
    }

    const updatedAdmin = await admin.save();
    res.json({
      success: true,
      message: "Profile updated successfully",
      admin: {
        _id: updatedAdmin._id,
        name: updatedAdmin.name,
        email: updatedAdmin.email,
        phoneNumber: updatedAdmin.phoneNumber,
        department: updatedAdmin.department,
        role: updatedAdmin.role,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
