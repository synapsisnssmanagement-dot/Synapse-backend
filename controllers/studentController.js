import Student from "../models/Student.js";
import bcrypt from "bcrypt";
import cloudinary from "../utils/cloudinary.js";
import { sendEmail } from "../utils/sendEmail.js";
import jwt from "jsonwebtoken";
import Event from "../models/Event.js";
import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";
import { count } from "console";
import Institution from "../models/Institution.js";
import OpenAI from "openai";
import { HfInference } from "@huggingface/inference";
import dotenv from "dotenv";

dotenv.config();

// Initialize AI Clients
const openai = new OpenAI({
  apiKey: process.env.OPEN_AI_KEY,
});

// OTP generation (6 digits)
const generateOtp = () => Math.floor(100000 + Math.random() * 900000);

// Token generation
const generateToken = (student) => {
  return jwt.sign(
    { id: student._id, role: "student" },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
};

// Student Signup
export const studentSignUp = async (req, res) => {
  try {
    const {
      name,
      email,
      phoneNumber,
      department,
      talents,
      password,
      institution,
    } = req.body;

    const emailExist = await Student.findOne({ email });
    if (emailExist) {
      return res
        .status(400)
        .json({ success: false, message: "Email already exists" });
    }

    let profileImage = {};
    if (req.file) {
      profileImage = {
        url: req.file.path,
        public_id: req.file.filename,
      };
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const otp = generateOtp();

    const student = await Student.create({
      name,
      email,
      phoneNumber,
      department,
      talents,
      password: hashedPassword,
      otp,
      otpExpiry: Date.now() + 5 * 60 * 1000, // 5 mins
      status: "pending",
      profileImage,
      institution,
    });

    await Institution.findByIdAndUpdate(institution, {
      $push: { students: student._id },
    });

    await sendEmail(email, "Verify your NSS account", `Your OTP is ${otp}`);

    res.status(201).json({
      success: true,
      message: "Signup successful. Please verify OTP.",
      userId: student._id,
      role: "student",
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Verify OTP
export const verifyOtp = async (req, res) => {
  try {
    const { studentId, otp } = req.body;

    const student = await Student.findById(studentId);
    if (!student) {
      return res
        .status(404)
        .json({ success: false, message: "Student not found" });
    }

    if (student.otp !== Number(otp) || student.otpExpiry < Date.now()) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid or expired OTP" });
    }

    student.otp = null;
    student.otpExpiry = null;
    await student.save();

    res.json({
      success: true,
      message: "OTP has been verified,now wait for admin approval",
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Student Login
export const studentLogin = async (req, res) => {
  try {
    const { email, password } = req.body;

    const student = await Student.findOne({ email });
    if (!student) {
      return res
        .status(404)
        .json({ success: false, message: "Student not found" });
    }

    const isMatch = await bcrypt.compare(password, student.password);
    if (!isMatch) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid credentials" });
    }

    if (student.status !== "active") {
      return res.status(403).json({
        success: false,
        message: "Account not active. Wait for admin approval.",
      });
    }

    const token = generateToken(student);

    res.json({
      success: true,
      message: "Login successful",
      token,
      student: {
        id: student._id,
        name: student.name,
        email: student.email,
        role: "student",
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Admin Create Student
export const adminCreateStudent = async (req, res) => {
  try {
    const { name, email, phoneNumber, department, talents, password } =
      req.body;

    const existing = await Student.findOne({ email });
    if (existing) {
      return res
        .status(400)
        .json({ success: false, message: "Student already exists" });
    }

    let profileImage = {};
    if (req.file) {
      profileImage = {
        url: req.file.path,
        public_id: req.file.filename,
      };
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const student = await Student.create({
      name,
      email,
      phoneNumber,
      department,
      talents,
      password: hashedPassword,
      status: "active", // directly active when created by admin
      profileImage,
    });

    res.status(201).json({
      success: true,
      message: "Student created by admin successfully",
      student,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Approve Student
export const approveStudent = async (req, res) => {
  try {
    const student = await Student.findById(req.params.id);
    if (!student) {
      return res
        .status(404)
        .json({ success: false, message: "Student not found" });
    }

    student.status = "active";
    await student.save();

    res.json({
      success: true,
      message: "Student approved successfully",
      student,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Update Student (Details + Image)
export const studentUpdate = async (req, res) => {
  try {
    const { id } = req.params;

    const student = await Student.findById(id);
    if (!student) {
      return res
        .status(404)
        .json({ success: false, message: "Student not found" });
    }

    const { name, phoneNumber, department, talents, status } = req.body;

    if (name) student.name = name;
    if (phoneNumber) student.phoneNumber = phoneNumber;
    if (department) student.department = department;
    if (talents) {
      student.talents = Array.isArray(talents) ? talents : [talents];
    }

    if (status) student.status = status; // should only be set by admin

    if (req.file) {
      if (student.profileImage?.public_id) {
        await cloudinary.uploader.destroy(student.profileImage.public_id);
      }
      student.profileImage = {
        url: req.file.path,
        public_id: req.file.filename,
      };
    }

    await student.save();

    res.json({
      success: true,
      message: "Student updated successfully",
      student,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Delete Student
export const deleteStudent = async (req, res) => {
  try {
    const student = await Student.findById(req.params.id);
    if (!student) {
      return res
        .status(404)
        .json({ success: false, message: "Student not found" });
    }

    if (student.profileImage?.public_id) {
      await cloudinary.uploader.destroy(student.profileImage.public_id);
    }

    await student.deleteOne();

    res.json({ success: true, message: "Student deleted successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get Student Events
export const getStudentEvents = async (req, res) => {
  try {
    const student = await Student.findById(req.params.id).populate(
      "assignedEvents",
      "title description date location hours"
    );

    if (!student) {
      return res
        .status(404)
        .json({ success: false, message: "Student not found" });
    }

    res.json({ success: true, events: student.assignedEvents });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Remove Student from Event
export const removeStudentFromEvent = async (req, res) => {
  try {
    const { studentId, eventId } = req.params;

    const student = await Student.findById(studentId);
    const event = await Event.findById(eventId);

    if (!student || !event) {
      return res
        .status(404)
        .json({ success: false, message: "Student or Event not found" });
    }

    student.assignedEvents = student.assignedEvents.filter(
      (id) => id.toString() !== eventId
    );
    await student.save();

    event.participants = event.participants.filter(
      (id) => id.toString() !== studentId
    );
    await event.save();

    res.json({
      success: true,
      message: "Student removed from event successfully",
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// certificate genration
export const generateOwnCertificate = async (req, res) => {
  try {
    const { eventId } = req.params;
    const studentId = req.user._id;

    const event = await Event.findById(eventId).populate(
      "participants",
      "_id name department"
    );
    if (!event) {
      return res
        .status(404)
        .json({ success: false, message: "Event not found" });
    }

    if (event.status !== "Completed") {
      return res.status(400).json({
        success: false,
        message: "Certificate available only after event completion",
      });
    }

    const isParticipant = event.participants.some(
      (p) => p._id.toString() === studentId.toString()
    );
    if (!isParticipant) {
      return res.status(403).json({
        success: false,
        message: "You did not participate in this event",
      });
    }

    const student = await Student.findById(studentId);
    if (!student) {
      return res
        .status(404)
        .json({ success: false, message: "Student not found" });
    }

    // Folder setup
    const folder = path.join("uploads", "certificates");
    if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });

    const fileName = `certificate_${event._id}_${student._id}.pdf`;
    const filePath = path.join(folder, fileName);

    const doc = new PDFDocument({ layout: "landscape", size: "A4" });
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    // certifiacte
    // Colors & styling
    const mainColor = "#003366";
    const accentColor = "#D4AF37"; // gold
    const textColor = "#1a1a1a";

    // Background
    doc.rect(0, 0, doc.page.width, doc.page.height).fill("#FAFAFA");
    doc.fillColor(textColor);

    // Border
    doc
      .lineWidth(12)
      .strokeColor(mainColor)
      .rect(25, 25, doc.page.width - 50, doc.page.height - 50)
      .stroke();

    // Inner thin border
    doc
      .lineWidth(2)
      .strokeColor(accentColor)
      .rect(45, 45, doc.page.width - 90, doc.page.height - 90)
      .stroke();

    // Watermark logo (light)
    const logoPath = "/logo.png"; // path to your NSS logo
    if (fs.existsSync(logoPath)) {
      doc.opacity(0.08);
      doc.image(logoPath, doc.page.width / 2 - 150, doc.page.height / 2 - 150, {
        width: 300,
      });
      doc.opacity(1);
    }

    // Header
    doc
      .font("Helvetica-Bold")
      .fontSize(28)
      .fillColor(mainColor)
      .text("National Service Scheme (NSS)", { align: "center" });

    doc
      .font("Helvetica")
      .fontSize(14)
      .fillColor("#333")
      .text(
        "Under the Ministry of Youth Affairs and Sports, Government of India",
        {
          align: "center",
        }
      );

    // Title
    doc.moveDown(2);
    doc
      .font("Times-BoldItalic")
      .fontSize(34)
      .fillColor(accentColor)
      .text("Certificate of Appreciation", { align: "center" });

    // Decorative line
    const lineY = doc.y + 10;
    doc
      .moveTo(180, lineY)
      .lineTo(doc.page.width - 180, lineY)
      .lineWidth(2)
      .stroke(accentColor);

    // Recipient name
    doc.moveDown(2);
    doc
      .font("Times-BoldItalic")
      .fontSize(32)
      .fillColor("#000")
      .text(student.name, { align: "center" });

    // Text body
    doc.moveDown(1.5);
    doc
      .font("Times-Roman")
      .fontSize(18)
      .fillColor("#333333")
      .text(
        `of the ${
          student.department
        } Department is hereby awarded this certificate in recognition of their valuable participation in the event "${
          event.title
        }", conducted on ${new Date(event.date).toLocaleDateString()}.`,
        {
          align: "center",
          lineGap: 10,
          indent: 40,
        }
      );

    // Signature lines
    const sigY = doc.page.height - 130;

    doc
      .font("Helvetica")
      .fontSize(14)
      .text("_________________________", 150, sigY)
      .text("_________________________", doc.page.width - 350, sigY);

    doc
      .font("Helvetica-Bold")
      .fontSize(12)
      .text("Program Officer", 150, sigY + 15)
      .text("Principal / NSS Coordinator", doc.page.width - 350, sigY + 15);

    // Footer
    doc
      .font("Helvetica-Oblique")
      .fontSize(10)
      .fillColor("#666")
      .text(
        "Generated by SYNAPSIS NSS Management Portal",
        0,
        doc.page.height - 50,
        {
          align: "center",
        }
      );

    /* ============================================ */

    doc.end();

    stream.on("finish", () => {
      res.download(filePath, fileName, (err) => {
        if (err) console.error("File download error:", err);
        fs.unlink(filePath, () => {});
      });
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// admin dashboard works

// pending
export const getPendingStudent = async (req, res) => {
  try {
    const pendingStudents = await Student.find({ status: "pending" }).select(
      "-password -otp -otpExpiry"
    );

    res.json({
      success: true,
      count: pendingStudents.length,
      students: pendingStudents,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// approve Student
export const approvePendingStudent = async (req, res) => {
  try {
    const { id } = req.params;
    const student = await Student.findById(id);
    if (!student) {
      return res
        .status(404)
        .json({ success: false, message: "Student Not Found" });
    }

    if (student.status === "active") {
      return res
        .status(400)
        .json({ success: false, message: "Student Already" });
    }

    student.status = "active";
    await student.save();
    res.json({
      success: true,
      message: `${student.name} has been approved successfully`,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// reject student
export const rejectStudent = async (req, res) => {
  try {
    const { id } = req.params;
    const student = await Student.findById(id);
    if (!student) {
      return res
        .status(404)
        .json({ success: false, message: "Student Not Found" });
    }

    if (student.status === "active") {
      return res
        .status(400)
        .json({ success: false, message: "Student Already active" });
    }
    student.status = "rejected";
    if (student.profileImage?.public_id) {
      await cloudinary.uploader.destroy(student.profileImage.public_id);
    }

    await student.save();
    res.json({
      success: true,
      message: `${student.name} has been rejected successfully`,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get all students with their status
export const getAllStudents = async (req, res) => {
  try {
    const students = await Student.find()
      .select("-password -otp -otpExpiry") // don’t return sensitive data
      .populate("institution", "name address")
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      count: students.length,
      students,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const rejectInDashboardStudent = async (req, res) => {
  try {
    const student = await Student.findByIdAndUpdate(
      req.params.id,
      { status: "rejected" },
      { new: true }
    );
    if (!student)
      return res
        .status(404)
        .json({ success: false, message: "Student not found" });
    res.json({
      success: true,
      message: "Student rejected successfully",
      student,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// dashboard
// export const getStudentDashboard = async (req, res) => {
//   try {
//     const studentId = req.user.id; // 🟢 Extract from token

//     const student = await Student.findById(studentId)
//       .populate("assignedEvents", "title status hours date location")
//       .select("-password -otp -otpExpiry");

//     if (!student) {
//       return res.status(404).json({ success: false, message: "Student not found" });
//     }

//     // Calculate event stats
//     const totalEvents = student.assignedEvents.length;
//     const completedEvents = student.assignedEvents.filter(
//       (e) => e.status === "Completed"
//     ).length;
//     const totalHours = student.assignedEvents.reduce(
//       (sum, e) => sum + (e.hours || 0),
//       0
//     );

//     // Update student totalHours if different
//     if (student.totalHours !== totalHours) {
//       student.totalHours = totalHours;
//       await student.save();
//     }

//     res.json({
//       success: true,
//       dashboard: {
//         student,
//         totalEvents,
//         completedEvents,
//         totalHours,
//         graceMarks: student.graceMarks,
//         awards: student.awards,
//       },
//     });
//   } catch (error) {
//     console.error("Dashboard Error:", error);
//     res.status(500).json({ success: false, message: error.message });
//   }
// };

export const getStudentDashboard = async (req, res) => {
  try {
    const studentId = req.user.id; // ✅ Extract from token (protect middleware)

    const student = await Student.findById(studentId)
      .populate({
        path: "institution",
        select: "name address type", // ✅ Include institution details
      })
      .populate({
        path: "assignedEvents",
        select: "title status hours date location description assignedTeacher",
        populate: {
          path: "assignedTeacher",
          select: "name email",
        },
      })
      .select("-password -otp -otpExpiry");

    if (!student) {
      return res.status(404).json({
        success: false,
        message: "Student not found",
      });
    }

    // ✅ Calculate event stats
    const totalEvents = student.assignedEvents.length;
    const completedEvents = student.assignedEvents.filter(
      (e) => e.status === "Completed"
    ).length;

    const totalHours = student.assignedEvents.reduce(
      (sum, e) => sum + (e.hours || 0),
      0
    );

    // ✅ Grace marks rule (if applicable)
    let graceMarks = student.graceMarks || 0;
    if (totalHours >= 100 && totalHours < 200) graceMarks = 5;
    else if (totalHours >= 200) graceMarks = 10;

    // ✅ Auto-update totalHours and graceMarks if needed
    if (
      student.totalHours !== totalHours ||
      student.graceMarks !== graceMarks
    ) {
      student.totalHours = totalHours;
      student.graceMarks = graceMarks;
      await student.save();
    }

    // ✅ Awards (if totalHours crosses milestones)
    let autoAwards = [];
    if (totalHours >= 50) autoAwards.push("Bronze NSS Volunteer");
    if (totalHours >= 100) autoAwards.push("Silver NSS Volunteer");
    if (totalHours >= 200) autoAwards.push("Gold NSS Volunteer");

    // Merge manual + auto awards
    const awards = [
      ...(student.awards || []),
      ...autoAwards.map((title) => ({ name: title })),
    ];

    // ✅ Final dashboard response
    res.json({
      success: true,
      dashboard: {
        student: {
          id: student._id,
          name: student.name,
          email: student.email,
          phoneNumber: student.phoneNumber,
          department: student.department,
          talents: student.talents,
          profileImage: student.profileImage?.url || null,
          institution: student.institution
            ? {
                name: student.institution.name,
                address: student.institution.address,
              }
            : null,
        },
        stats: {
          totalEvents,
          completedEvents,
          totalHours,
          graceMarks,
        },
        awards,
        assignedEvents: student.assignedEvents.map((ev) => ({
          id: ev._id,
          title: ev.title,
          description: ev.description,
          status: ev.status,
          hours: ev.hours,
          date: ev.date,
          location: ev.location,
          teacher:
            ev.assignedTeacher && ev.assignedTeacher.length
              ? ev.assignedTeacher.map((t) => t.name).join(", ")
              : "N/A",
        })),
      },
    });
  } catch (error) {
    console.error("Dashboard Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// profile
export const getStudentProfile = async (req, res) => {
  try {
    const studentId = req.user.id; // 🟢 Extracted from token

    const student = await Student.findById(studentId)
      .select("-password -otp -otpExpiry")
      .populate("institution", "name address");

    if (!student) {
      return res
        .status(404)
        .json({ success: false, message: "Student not found" });
    }

    res.json({
      success: true,
      student,
    });
  } catch (error) {
    console.error("Profile Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// edit
// Edit Student Profile
export const editStudentProfile = async (req, res) => {
  try {
    const studentId = req.user.id; // ✅ Extracted from JWT token
    const { name, phoneNumber, department, talents } = req.body;

    const student = await Student.findById(studentId);
    if (!student) {
      return res
        .status(404)
        .json({ success: false, message: "Student not found" });
    }

    // ✅ Update fields only if provided
    if (name) student.name = name;
    if (phoneNumber) student.phoneNumber = phoneNumber;
    if (department) student.department = department;
    if (talents) {
      student.talents = Array.isArray(talents) ? talents : [talents];
    }

    // ✅ Profile image update
    if (req.file) {
      // Delete old image from cloudinary if exists
      if (student.profileImage?.public_id) {
        await cloudinary.uploader.destroy(student.profileImage.public_id);
      }

      student.profileImage = {
        url: req.file.path,
        public_id: req.file.filename,
      };
    }

    await student.save();

    res.json({
      success: true,
      message: "Profile updated successfully",
      student: {
        id: student._id,
        name: student.name,
        email: student.email,
        phoneNumber: student.phoneNumber,
        department: student.department,
        talents: student.talents,
        profileImage: student.profileImage?.url || null,
        institution: student.institution,
      },
    });
  } catch (error) {
    console.error("Profile Edit Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// controllers/studentController.js

export const getFilteredStudentEvents = async (req, res) => {
  try {
    const studentId = req.user?.id; // From JWT middleware
    const { status, teacherId, coordinatorId, startDate, endDate } = req.query;

    if (!studentId) {
      return res.status(400).json({
        success: false,
        message: "Missing student ID in token",
      });
    }

    // ✅ Base query: find events where student is a participant
    const query = { participants: studentId };

    if (status) query.status = new RegExp(`^${status}$`, "i");
    if (teacherId) query.assignedTeacher = teacherId;
    if (coordinatorId) query.assignedCoordinators = coordinatorId;
    if (startDate && endDate) {
      query.date = { $gte: new Date(startDate), $lte: new Date(endDate) };
    }

    const events = await Event.find(query)
      .populate("assignedTeacher", "name email department phoneNumber")
      .populate("assignedCoordinators", "name email department phoneNumber")
      .populate("institution", "name address")
      .sort({ date: -1 });

    if (!events || events.length === 0) {
      return res.status(200).json({
        success: true,
        message: "No events found for this student",
        filters: { statuses: [], teachers: [], coordinators: [] },
        events: [],
      });
    }

    // ✅ Build dropdown filters safely
    const uniqueTeachers = new Map();
    const uniqueCoordinators = new Map();
    const statuses = new Set();

    events.forEach((e) => {
      if (e.status) statuses.add(e.status);

      // 🧑‍🏫 Assigned Teachers (handle both array and single)
      if (e.assignedTeacher) {
        const teachers = Array.isArray(e.assignedTeacher)
          ? e.assignedTeacher
          : [e.assignedTeacher];

        teachers.forEach((t) => {
          if (t?._id) {
            uniqueTeachers.set(String(t._id), {
              id: t._id,
              name: t.name,
              email: t.email,
              department: t.department || "N/A",
              phoneNumber: t.phoneNumber || "N/A",
            });
          }
        });
      }

      // 👨‍🏫 Assigned Coordinators (handle both array and single)
      if (e.assignedCoordinators) {
        const coordinators = Array.isArray(e.assignedCoordinators)
          ? e.assignedCoordinators
          : [e.assignedCoordinators];

        coordinators.forEach((c) => {
          if (c?._id) {
            uniqueCoordinators.set(String(c._id), {
              id: c._id,
              name: c.name,
              email: c.email,
              department: c.department || "N/A",
              phoneNumber: c.phoneNumber || "N/A",
            });
          }
        });
      }
    });

    const dropdownData = {
      statuses: Array.from(statuses),
      teachers: Array.from(uniqueTeachers.values()),
      coordinators: Array.from(uniqueCoordinators.values()),
    };

    // ✅ Format final events
    const formattedEvents = events.map((ev) => ({
      id: ev._id,
      title: ev.title,
      description: ev.description,
      date: ev.date,
      status: ev.status,
      hours: ev.hours,
      location: ev.location,
      teacher: Array.isArray(ev.assignedTeacher)
        ? ev.assignedTeacher.map((t) => ({
            id: t._id,
            name: t.name,
            email: t.email,
            department: t.department || "N/A",
            phoneNumber: t.phoneNumber || "N/A",
          }))
        : ev.assignedTeacher
        ? {
            id: ev.assignedTeacher._id,
            name: ev.assignedTeacher.name,
            email: ev.assignedTeacher.email,
            department: ev.assignedTeacher.department || "N/A",
            phoneNumber: ev.assignedTeacher.phoneNumber || "N/A",
          }
        : null,
      coordinator: Array.isArray(ev.assignedCoordinators)
        ? ev.assignedCoordinators.map((c) => ({
            id: c._id,
            name: c.name,
            email: c.email,
            department: c.department || "N/A",
            phoneNumber: c.phoneNumber || "N/A",
          }))
        : ev.assignedCoordinators
        ? {
            id: ev.assignedCoordinators._id,
            name: ev.assignedCoordinators.name,
            email: ev.assignedCoordinators.email,
            department: ev.assignedCoordinators.department || "N/A",
            phoneNumber: ev.assignedCoordinators.phoneNumber || "N/A",
          }
        : null,
      institution: ev.institution
        ? {
            id: ev.institution._id,
            name: ev.institution.name,
            address: ev.institution.address,
          }
        : null,
    }));

    return res.status(200).json({
      success: true,
      message: "Student events fetched successfully",
      filters: dropdownData,
      events: formattedEvents,
    });
  } catch (error) {
    console.error("❌ Get Filtered Events Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// get event of student/volunteer
export const getMyEvents = async (req, res) => {
  try {
    const studentId = req.user._id; // from protect middleware
    const student = await Student.findById(studentId).populate(
      "assignedEvents"
    );

    if (!student) {
      return res.status(404).json({
        success: false,
        message: "Student not found",
      });
    }

    // If no assigned events
    if (!student.assignedEvents || student.assignedEvents.length === 0) {
      return res.status(200).json({
        success: true,
        events: [],
        message: "No events assigned yet",
      });
    }

    // ✅ Fetch full event details
    // Check if "coordinator" exists in Event schema before populating
    const populateOptions = [
      { path: "institution", select: "name" }, // only if institution exists
    ];

    // If your Event schema actually includes coordinator, uncomment this:
    // populateOptions.push({ path: "coordinator", select: "name email" });

    const events = await Event.find({
      _id: { $in: student.assignedEvents },
    })
      .populate(populateOptions)
      .sort({ date: -1 });

    return res.status(200).json({
      success: true,
      events,
    });
  } catch (error) {
    console.error("❌ Error fetching student events:", error);
    return res.status(500).json({
      success: false,
      message: "Server error fetching student events",
    });
  }
};

export const generateAICertificate = async (req, res) => {
  try {
    const { eventId } = req.params;
    const studentId = req.user._id;

    const event = await Event.findById(eventId).populate(
      "participants",
      "_id name department"
    );
    if (!event)
      return res
        .status(404)
        .json({ success: false, message: "Event not found" });

    if (event.status !== "Completed")
      return res
        .status(400)
        .json({
          success: false,
          message: "Certificate available only after event completion",
        });

    const isParticipant = event.participants.some(
      (p) => p._id.toString() === studentId.toString()
    );
    if (!isParticipant)
      return res
        .status(403)
        .json({
          success: false,
          message: "You are not a participant in this event",
        });

    const student = await Student.findById(studentId);
    if (!student)
      return res
        .status(404)
        .json({ success: false, message: "Student not found" });

    // ---------------- AI TEXT GENERATION ----------------
    const eventDate = new Date(event.date).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });

    const prompt = `
      Write exactly 2 elegant, formal sentences for a National Service Scheme certificate.
      - Student: ${student.name}, Department of ${student.department}
      - Event: "${event.title}" held on ${eventDate}
      - Emphasize dedication, leadership, and social commitment.
      - Do not use quotes or headings.
    `;

    let aiText = "";
    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "You are an NSS certificate text generator.",
          },
          { role: "user", content: prompt },
        ],
        max_tokens: 120,
        temperature: 0.7,
      });
      aiText = completion.choices[0].message.content.trim();
    } catch {
      aiText = `This is to certify that ${student.name} from the Department of ${student.department} actively participated in "${event.title}" on ${eventDate}. Their enthusiasm and commitment reflect the true spirit of the National Service Scheme.`;
    }

    // ---------------- PDF DESIGN ----------------
    const folder = path.join("uploads", "certificates");
    if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });

    const fileName = `NSS_Certificate_${event._id}_${student._id}.pdf`;
    const filePath = path.join(folder, fileName);

    const doc = new PDFDocument({ autoFirstPage: false });
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    // Create ONE page manually (A4 landscape)
    const W = 842; // width in points
    const H = 595; // height in points
    doc.addPage({ size: [W, H], margin: 40 });

    // Colors
    const navy = "#0B3D91";
    const gold = "#C8A600";
    const textDark = "#1C1C1C";

    // Borders
    doc.rect(0, 0, W, H).fill("#FFFFFF");
    doc
      .lineWidth(10)
      .strokeColor(navy)
      .rect(25, 25, W - 50, H - 50)
      .stroke();
    doc
      .lineWidth(3)
      .strokeColor(gold)
      .rect(40, 40, W - 80, H - 80)
      .stroke();

    // Fixed Y coordinates (everything fits in one page)
    const headerY = 70;
    const subtitleY = 110;
    const titleY = 160;
    const textY = 240;
    const nameY = 345;
    const deptY = 380;
    const dateY = 400;
    const sigY = 455;
    const footerY = 530;

    // Header
    doc
      .font("Helvetica-Bold")
      .fontSize(28)
      .fillColor(navy)
      .text("National Service Scheme (NSS)", 0, headerY, { align: "center" });

    doc
      .font("Helvetica")
      .fontSize(13)
      .fillColor("#555")
      .text(
        "Under the Ministry of Youth Affairs & Sports, Government of India",
        0,
        subtitleY,
        { align: "center" }
      );

    // Title
    doc
      .font("Times-BoldItalic")
      .fontSize(36)
      .fillColor(gold)
      .text("Certificate of Appreciation", 0, titleY, { align: "center" });

    // AI body text (bounded box)
    const textWidth = W - 200;
    doc
      .font("Times-Roman")
      .fontSize(16)
      .fillColor(textDark)
      .text(aiText, (W - textWidth) / 2, textY, {
        width: textWidth,
        align: "center",
        lineGap: 6,
        height: 90,
        ellipsis: true,
      });

    // Name & Dept
    doc
      .font("Times-BoldItalic")
      .fontSize(24)
      .fillColor(navy)
      .text(student.name, 0, nameY, { align: "center" });
    doc
      .font("Times-Italic")
      .fontSize(15)
      .fillColor("#555")
      .text(`Department of ${student.department}`, 0, deptY, {
        align: "center",
      });

    // Signatures
    doc
      .font("Helvetica")
      .fontSize(12)
      .fillColor(textDark)
      .text("_______________________", 120, sigY);
    doc.font("Helvetica-Bold").text("Teacher", 175, sigY + 18);

    doc
      .font("Helvetica")
      .fontSize(12)
      .text("_______________________", W - 300, sigY);
    doc
      .font("Helvetica-Bold")
      .text("Principal / NSS Coordinator", W - 300, sigY + 18);

    // Date
    const issueDate = new Date().toLocaleDateString("en-IN", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    doc
      .font("Helvetica-Oblique")
      .fontSize(12)
      .fillColor("#333")
      .text(`Date of Issue: ${issueDate}`, 0, dateY, { align: "center" });

    // Footer
    doc
      .font("Helvetica-Oblique")
      .fontSize(10)
      .fillColor("#777")
      .text("Generated by SYNAPSIS NSS Management Portal", 0, footerY, {
        align: "center",
      });

    doc.end();

    // ---------------- SEND FILE ----------------
    stream.on("finish", () => {
      res.download(filePath, fileName, (err) => {
        if (err) console.error("Download error:", err);
        fs.unlink(filePath, () => {});
      });
    });
  } catch (error) {
    console.error("Certificate Error:", error);
    if (!res.headersSent)
      res.status(500).json({ success: false, message: error.message });
  }
};





// ✅ Get Student Attendance for a Specific Event
export const getStudentAttendanceForEvent = async (req, res) => {
  try {
    const { eventId } = req.params;
    const studentId = req.user._id; // 🟢 from JWT middleware

    // 1️⃣ Find event and populate attendance
    const event = await Event.findById(eventId)
      .populate("attendance.student", "name department")
      .populate("attendance.markedBy", "name email");

    if (!event)
      return res.status(404).json({
        success: false,
        message: "Event not found",
      });

    // 2️⃣ Find student attendance record
    const record = event.attendance.find(
      (a) => a.student._id.toString() === studentId.toString()
    );

    if (!record) {
      return res.status(200).json({
        success: true,
        message: "Attendance not marked yet for this student",
        event: {
          id: event._id,
          title: event.title,
          date: event.date,
          location: event.location,
        },
        attendance: {
          status: "Not Marked",
          markedBy: null,
          date: null,
        },
      });
    }

    // 3️⃣ Return attendance info
    res.status(200).json({
      success: true,
      message: "Attendance fetched successfully",
      event: {
        id: event._id,
        title: event.title,
        date: event.date,
        location: event.location,
      },
      attendance: {
        status: record.status,
        markedBy: record.markedBy
          ? {
              id: record.markedBy._id,
              name: record.markedBy.name,
              email: record.markedBy.email,
            }
          : null,
        date: record.date,
      },
    });
  } catch (error) {
    console.error("❌ Attendance Fetch Error:", error);
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};


// upload images
export const uploadEventImages = async (req, res) => {
  try {
    const { id } = req.params;
    const { captions } = req.body; // optional captions array (can be stringified)

    const event = await Event.findById(id);
    if (!event) {
      return res.status(404).json({
        success: false,
        message: "Event not found",
      });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No images uploaded",
      });
    }

    const uploadedImages = [];

    for (let i = 0; i < req.files.length; i++) {
      const file = req.files[i];
      try {
        // ✅ Upload to Cloudinary
        const uploadResult = await cloudinary.uploader.upload(file.path, {
          folder: "event_images",
        });

        // ✅ Push uploaded info
        uploadedImages.push({
          url: uploadResult.secure_url,
          public_id: uploadResult.public_id,
          caption:
            Array.isArray(captions) && captions[i]
              ? captions[i]
              : typeof captions === "string"
              ? captions
              : "",
          uploadAt: new Date(),
        });
      } catch (uploadErr) {
        console.error("Cloudinary upload failed:", uploadErr.message);
      } finally {
        // ✅ Safely delete local temp file if it exists
        try {
          if (fs.existsSync(file.path)) {
            fs.unlinkSync(file.path);
          }
        } catch (unlinkErr) {
          console.warn("Local file cleanup skipped:", unlinkErr.message);
        }
      }
    }

    // ✅ Append to existing images (instead of replacing)
    event.images = [...(event.images || []), ...uploadedImages];
    await event.save();

    return res.status(200).json({
      success: true,
      message: "Images uploaded successfully",
      images: uploadedImages,
    });
  } catch (error) {
    console.error("❌ Error uploading event images:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Internal server error",
    });
  }
};
