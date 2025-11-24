import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import Teacher from "../models/Teacher.js";
import cloudinary from "../utils/cloudinary.js";
import { sendEmail } from "../utils/sendEmail.js";
import Student from "../models/Student.js";
import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";
import Event from "../models/Event.js";
import Institution from "../models/Institution.js";
import Coordinator from "../models/Coordinator.js";
import { HfInference } from "@huggingface/inference";
import OpenAI from "openai";

const generateToken = (id) =>
  jwt.sign({ id, role: "teacher" }, process.env.JWT_SECRET, {
    expiresIn: "7d",
  });

const hf = new HfInference(process.env.HUGGINGFACE_TOKEN);

const openai = new OpenAI({
  apiKey: process.env.OPEN_AI_KEY,
});

const generateOtp = () => Math.floor(100000 + Math.random() * 900000);

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const passwordRegex =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;

// signup
export const teacherSignUp = async (req, res) => {
  try {
    const { name, email, phoneNumber, department, password, institutionId } =
      req.body;

    if (!emailRegex.test(email)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid email format" });
    }

    if (!passwordRegex.test(password)) {
      return res.status(400).json({
        success: false,
        message:
          "Password must be 8+ chars, include uppercase, lowercase, number, and special character",
      });
    }

    const exists = await Teacher.findOne({ email });
    if (exists) {
      return res
        .status(400)
        .json({ success: false, message: "Email already exists" });
    }

    const hashed = await bcrypt.hash(password, 10);
    const otp = generateOtp();

    let profileImage = { url: "", public_id: "" };
    let verificationDocument = { url: "", public_id: "" };

    if (req.files?.profileImage?.[0]) {
      const uploaded = await cloudinary.uploader.upload(
        req.files.profileImage[0].path,
        { folder: "teacher_profiles" }
      );
      profileImage = {
        url: uploaded.secure_url,
        public_id: uploaded.public_id,
      };
    }

    if (req.files?.verificationDocument?.[0]) {
      const uploaded = await cloudinary.uploader.upload(
        req.files.verificationDocument[0].path,
        { folder: "teacher_verify_documents" }
      );
      verificationDocument = {
        url: uploaded.secure_url,
        public_id: uploaded.public_id,
      };
    } else {
      return res.status(400).json({
        success: false,
        message: "Verification document is required.",
      });
    }

    const teacher = await Teacher.create({
      name,
      email,
      phoneNumber,
      department,
      password: hashed,
      otp,
      otpExpiry: Date.now() + 5 * 60 * 1000,
      profileImage,
      institution: institutionId,
      verificationDocument,
      status: "pending", // waiting for admin approval
      verifiedByAdmin: false,
    });

    await Institution.findByIdAndUpdate(institutionId, {
      $push: { teacher: teacher._id },
    });

    // otp
    await sendEmail(email, "Verify your Teacher account", `Your OTP is ${otp}`);

    return res.status(201).json({
      success: true,
      message:
        "Signup successful! Verify OTP sent to your email. Wait for admin approval after verification.",
      userId: teacher._id,
      role: "teacher",
    });
  } catch (error) {
    console.error("Error in teacher signup:", error);
    return res
      .status(500)
      .json({ success: false, message: "Signup failed: " + error.message });
  }
};

export const verifyOtp = async (req, res) => {
  try {
    const { teacherId, otp } = req.body;
    const teacher = await Teacher.findById(teacherId);
    if (!teacher) {
      return res
        .status(404)
        .json({ success: false, message: "Teacher not found" });
    }
    if (teacher.otp !== Number(otp) || teacher.otpExpiry < Date.now()) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid or expired OTP" });
    }

    teacher.otp = null;
    teacher.otpExpiry = null;
    await teacher.save();
    res.json({
      success: true,
      message: "OTP verified. Now wait for admin approval",
      teacher,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const teacherLogin = async (req, res) => {
  try {
    const { email, password } = req.body;
    const teacher = await Teacher.findOne({ email });
    if (!teacher) {
      return res
        .status(404)
        .json({ success: false, message: "teacher not found" });
    }
    const match = await bcrypt.compare(password, teacher.password);
    if (!match) {
      return req
        .status(400)
        .json({ success: false, message: "Invalid Credentials" });
    }
    if (teacher.status !== "active") {
      return res.status(403).json({ message: "Account not active" });
    }
    const token = generateToken(teacher._id);

    res.json({ success: true, message: "Login succssfully", token });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// admin operation

// // approve teacher
// export const approveTeacher = async (req, res) => {
//   try {
//     const teacher = await Teacher.findById(req.params.id);
//     if (!teacher) {
//       return res
//         .status(404)
//         .json({ success: false, message: "teacher not found" });
//     }
//     teacher.status = "active";
//     await teacher.save();
//     res.json({ success: true, message: "Teacher approved successfully" });
//   } catch (error) {
//     res.status(500).json({ success: false, message: error.message });
//   }
// };

// assign teacher to event
export const assignTeacherToEvent = async (req, res) => {
  try {
    const { teacherId, eventId } = req.body;
    const teacher = await Teacher.findById(teacherId);
    const event = await Event.findById(eventId);
    if (!teacher) {
      return res
        .status(404)
        .json({ success: false, message: "Teacher not found" });
    }
    if (!event) {
      return res
        .status(404)
        .json({ success: true, message: "Event not found" });
    }

    if (!teacher.assignedEvents.includes(eventId))
      teacher.assignedEvents.push(eventId);

    if (!event.assignedTeacher.includes(teacherId))
      event.assignedTeacher.push(teacherId);

    await teacher.save();
    await event.save();

    res.json({ success: true, message: "Teacher is assigned to event" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// attendance
export const markAttendance = async (req, res) => {
  try {
    const { eventId } = req.params;
    const { attendanceList } = req.body;

    const event = await Event.findById(eventId);
    if (!event) {
      return res
        .status(404)
        .json({ success: false, message: "Event Not found" });
    }

    attendanceList.forEach(({ studentId, status }) => {
      const record = event.attendance.find(
        (a) => a.student.toString() === studentId
      );
      if (record) {
        record.status = status;
        record.markedAt = new Date();
      } else {
        event.attendance.push({
          student: studentId,
          status,
          markedBy: req.user?._id,
        });
      }
    });

    await event.save();
    res.json({
      success: true,
      message: "Attendance updated",
      attendance: event.attendance,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// genarate attendance pdf
// export const genrateAttendncePdfs = async (req, res) => {
//   try {
//     const event = await Event.findById(req.params.eventId).populate(
//       // inside events attendance arrays inside student only take name department graceMarks
//       "attendance.student",
//       "name department graceMarks"
//     );
//     if (!event) {
//       return res
//         .status(404)
//         .json({ success: false, message: "Event not found" });
//     }

//     const doc = new PDFDocument({ margin: 40 });
//     const fileName = `attandance_${event._id}.pdf`;
//     const filePath = path.join("uploads", fileName);

//     if (!fs.existsSync("uploads")) fs.mkdirSync("uploads");

//     const stream = fs.createWriteStream(filePath);
//     doc.pipe(stream);

//     doc
//       .fontSize(20)
//       .text(`Attendance Report - ${event.title}`, { align: "center" });

//     doc.moveDown();
//     doc.fontSize(12).text(`Date:${new Date(event.date).toLocaleDateString()}`);
//     doc.text(`Location: ${event.location}`);
//     doc.text(`Hours: ${event.hours}`);
//     doc.moveDown();
//     doc.text(
//       "No.  Name                         Dept          Status      GraceMarks"
//     );
//     (event.attendance || []).forEach((a, i) => {
//       const s = a.student || {};
//       doc.text(
//         `${i + 1}.     ${s.name || "-"}            ${
//           s.department || "-"
//         }              ${a.status}      ${s.graceMarks || 0}`
//       );
//     });
//     doc.end();
//     stream.on("finish", () => {
//       res.download(filePath, fileName, () => fs.unlinkSync(filePath));
//     });
//   } catch (error) {
//     res.status(500).json({ success: false, message: error.message });
//   }
// };

// export const generateAttendancePdf = async (req, res) => {
//   try {
//     const event = await Event.findById(req.params.eventId).populate(
//       "attendance.student",
//       "name department graceMarks"
//     );
//     if (!event) {
//       return res
//         .status(404)
//         .json({ success: false, message: "Event not found" });
//     }

//     const total = event.attendance.length;
//     const present = event.attendance.filter(
//       (a) => a.status === "Present"
//     ).length;
//     const percent = total ? ((present / total) * 100).toFixed(2) : 0;

//     // === AI Insight ===
//     let aiInsight = "AI insight could not be generated.";
//     try {
//       const completion = await openai.chat.completions.create({
//         model: "gpt-4o-mini",
//         messages: [
//           {
//             role: "system",
//             content:
//               "You write formal, impressive NSS-style attendance insights.",
//           },
//           {
//             role: "user",
//             content: `Generate a 3-sentence formal paragraph for an NSS attendance report based on:
// Event: ${event.title}
// Date: ${new Date(event.date).toDateString()}
// Location: ${event.location}
// Attendance Rate: ${percent}%
// Total Volunteers: ${total}
// Focus on social impact, volunteer engagement, and community value.`,
//           },
//         ],
//       });
//       aiInsight = completion.choices[0]?.message?.content?.trim() || aiInsight;
//     } catch (err) {
//       console.error("AI Error:", err.message);
//     }

//     // === PDF GENERATION ===
//     const doc = new PDFDocument({ margin: 50 });
//     const folder = "uploads";
//     if (!fs.existsSync(folder)) fs.mkdirSync(folder);

//     const fileName = `attendance_${event._id}.pdf`;
//     const filePath = path.join(folder, fileName);
//     const stream = fs.createWriteStream(filePath);
//     doc.pipe(stream);

//     const pageWidth = doc.page.width;
//     const pageHeight = doc.page.height;

//     // === GREEN THEME (Replaced Blue) ===
//     const primaryColor = "#2e7d32"; // Deep Green
//     const borderColor = "#4caf50"; // Light Green
//     const lightBg = "#e8f5e9"; // Very Light Green

//     // === HEADER BAR (Now with Event Name & Green) ===
//     doc.rect(0, 0, pageWidth, 80).fill(primaryColor);
//     doc
//       .fillColor("#ffffff")
//       .font("Helvetica-Bold")
//       .fontSize(22)
//       .text(event.title.toUpperCase(), 0, 28, { align: "center" }); // ← EVENT NAME
//     doc
//       .fontSize(13)
//       .font("Helvetica")
//       .text("Attendance Report", 0, 55, { align: "center" });

//     // === BORDER BOX ===
//     doc.lineWidth(1.2).strokeColor(borderColor);
//     doc.rect(40, 100, pageWidth - 80, pageHeight - 160).stroke();

//     // === EVENT DETAILS ===
//     doc.fillColor("black").font("Helvetica").fontSize(12);
//     doc.text(`Date: ${new Date(event.date).toLocaleDateString()}`, 60, 120);
//     doc.text(`Location: ${event.location}`, 60, 140);
//     doc.text(`Hours: ${event.hours || "-"} hrs`, 60, 160);
//     doc.text(`Total Volunteers: ${total}`, 60, 180);
//     doc.text(`Attendance Rate: ${percent}%`, 60, 200);

//     // === AI INSIGHT SECTION ===
//     const aiStartY = 240;
//     doc
//       .font("Helvetica-Bold")
//       .fontSize(14)
//       .fillColor(primaryColor)
//       .text("AI Attendance Insight", 60, aiStartY, {
//         underline: true,
//       });

//     const aiTextHeight = doc.heightOfString(aiInsight, {
//       width: pageWidth - 120,
//       align: "justify",
//       lineGap: 4,
//     });

//     doc
//       .font("Helvetica")
//       .fontSize(11)
//       .fillColor("black")
//       .text(aiInsight, 60, aiStartY + 25, {
//         width: pageWidth - 120,
//         align: "justify",
//         indent: 25,
//         lineGap: 4,
//       });

//     // === TABLE SETUP (Fits perfectly inside border) ===
//     const tableX = 60;
//     const tableWidth = pageWidth - 120;
//     const colWidths = [40, 120, 130, 80, 90];
//     const headers = ["No.", "Name", "Department", "Status", "Grace Marks"];

//     let y = aiStartY + aiTextHeight + 50;

//     // === TABLE HEADER ===
//     doc.rect(tableX, y, tableWidth, 28).fillAndStroke(lightBg, borderColor);
//     doc.fillColor(primaryColor).font("Helvetica-Bold").fontSize(11);
//     let x = tableX + 10;
//     headers.forEach((h, i) => {
//       const align = i === 0 || i === 4 ? "center" : "left";
//       doc.text(h, x, y + 8, { width: colWidths[i] - 10, align });
//       x += colWidths[i];
//     });
//     y += 28;

//     // === TABLE ROWS ===
//     doc.font("Helvetica").fontSize(10).fillColor("black");
//     event.attendance.forEach((a, i) => {
//       const s = a.student || {};
//       const bg = i % 2 === 0 ? "#ffffff" : "#f9f9f9";
//       const rowHeight = 25;

//       doc.rect(tableX, y, tableWidth, rowHeight).fillAndStroke(bg, "#c5cae9");
//       let x = tableX + 10;
//       const row = [
//         i + 1,
//         s.name || "-",
//         s.department || "-",
//         a.status || "-",
//         s.graceMarks || 0,
//       ];

//       row.forEach((val, j) => {
//         const align = j === 0 || j === 4 ? "center" : "left";
//         doc.fillColor("black").text(String(val), x, y + 7, {
//           width: colWidths[j] - 10,
//           align,
//         });
//         x += colWidths[j];
//       });
//       y += rowHeight;
//     });

//     // === WATERMARK (Updated to Green) ===
//     doc.fontSize(60).fillColor("#e8f5e9").opacity(0.15);
//     doc.rotate(-30, { origin: [pageWidth / 2, pageHeight / 2] });
//     doc.text("NSS", pageWidth / 2 - 100, pageHeight / 2);
//     doc.rotate(30).opacity(1);

//     // === FOOTER ===
//     doc
//       .moveTo(50, pageHeight - 80)
//       .lineTo(pageWidth - 50, pageHeight - 80)
//       .strokeColor(borderColor)
//       .lineWidth(1.2)
//       .stroke();
//     doc
//       .fontSize(10)
//       .fillColor("gray")
//       .text(
//         "Generated automatically by NSS Attendance Management System | AI Insights powered by OpenAI",
//         0,
//         pageHeight - 65,
//         { align: "center" }
//       );

//     doc.end();

//     stream.on("finish", () => {
//       res.download(filePath, fileName, () => fs.unlinkSync(filePath));
//     });
//   } catch (error) {
//     console.error("PDF Generation Error:", error);
//     res.status(500).json({ success: false, message: error.message });
//   }
// };

export const generateAttendancePdf = async (req, res) => {
  try {
    const event = await Event.findById(req.params.eventId).populate(
      "attendance.student",
      "name department graceHistory"
    );

    if (!event) {
      return res
        .status(404)
        .json({ success: false, message: "Event not found" });
    }

    const total = event.attendance.length;
    const present = event.attendance.filter(
      (a) => a.status === "Present"
    ).length;
    const percent = total ? ((present / total) * 100).toFixed(2) : 0;

    // === AI Insight ===
    let aiInsight = "AI insight could not be generated.";
    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "You write formal, impressive NSS-style attendance insights.",
          },
          {
            role: "user",
            content: `Generate a 3-sentence formal paragraph for an NSS attendance report based on:
Event: ${event.title}
Date: ${new Date(event.date).toDateString()}
Location: ${event.location}
Attendance Rate: ${percent}%
Total Volunteers: ${total}
Focus on social impact, volunteer engagement, and community value.`,
          },
        ],
      });
      aiInsight = completion.choices[0]?.message?.content?.trim() || aiInsight;
    } catch (err) {
      console.error("AI Error:", err.message);
    }

    // === PDF GENERATION ===
    const doc = new PDFDocument({ margin: 50 });
    const folder = "uploads";
    if (!fs.existsSync(folder)) fs.mkdirSync(folder);

    const fileName = `attendance_${event._id}.pdf`;
    const filePath = path.join(folder, fileName);
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;

    const primaryColor = "#2e7d32";
    const borderColor = "#4caf50";
    const lightBg = "#e8f5e9";

    // HEADER
    doc.rect(0, 0, pageWidth, 80).fill(primaryColor);
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(22);
    doc.text(event.title.toUpperCase(), 0, 28, { align: "center" });
    doc
      .fontSize(13)
      .font("Helvetica")
      .text("Attendance Report", 0, 55, { align: "center" });

    doc.lineWidth(1.2).strokeColor(borderColor);
    doc.rect(40, 100, pageWidth - 80, pageHeight - 160).stroke();

    doc.fillColor("black").font("Helvetica").fontSize(12);
    doc.text(`Date: ${new Date(event.date).toLocaleDateString()}`, 60, 120);
    doc.text(`Location: ${event.location}`, 60, 140);
    doc.text(`Hours: ${event.hours || "-"} hrs`, 60, 160);
    doc.text(`Total Volunteers: ${total}`, 60, 180);
    doc.text(`Attendance Rate: ${percent}%`, 60, 200);

    const aiStartY = 240;
    doc
      .font("Helvetica-Bold")
      .fontSize(14)
      .fillColor(primaryColor)
      .text("AI Attendance Insight", 60, aiStartY, { underline: true });

    const aiTextHeight = doc.heightOfString(aiInsight, {
      width: pageWidth - 120,
      align: "justify",
      lineGap: 4,
    });

    doc
      .font("Helvetica")
      .fontSize(11)
      .fillColor("black")
      .text(aiInsight, 60, aiStartY + 25, {
        width: pageWidth - 120,
        align: "justify",
        indent: 25,
        lineGap: 4,
      });

    const tableX = 60;
    const tableWidth = pageWidth - 120;
    const colWidths = [40, 120, 130, 80, 90];
    const headers = ["No.", "Name", "Department", "Status", "Grace Marks"];

    let y = aiStartY + aiTextHeight + 50;

    doc.rect(tableX, y, tableWidth, 28).fillAndStroke(lightBg, borderColor);
    doc.fillColor(primaryColor).font("Helvetica-Bold").fontSize(11);

    let x = tableX + 10;
    headers.forEach((h, i) => {
      const align = i === 0 || i === 4 ? "center" : "left";
      doc.text(h, x, y + 8, { width: colWidths[i] - 10, align });
      x += colWidths[i];
    });

    y += 28;

    // === TABLE ROWS (with correct event-wise grace marks) ===
    doc.font("Helvetica").fontSize(10).fillColor("black");

    event.attendance.forEach((a, i) => {
      const s = a.student || {};
      const bg = i % 2 === 0 ? "#ffffff" : "#f9f9f9";
      const rowHeight = 25;

      // event-wise grace mark
      const eventMark =
        s?.graceHistory?.find(
          (h) => h.eventId?.toString() === event._id.toString()
        )?.marks || 0;

      doc.rect(tableX, y, tableWidth, rowHeight).fillAndStroke(bg, "#c5cae9");

      let x = tableX + 10;
      const row = [
        i + 1,
        s.name || "-",
        s.department || "-",
        a.status || "-",
        eventMark,
      ];

      row.forEach((val, j) => {
        const align = j === 0 || j === 4 ? "center" : "left";
        doc.fillColor("black").text(String(val), x, y + 7, {
          width: colWidths[j] - 10,
          align,
        });
        x += colWidths[j];
      });

      y += rowHeight;
    });

    doc.fontSize(60).fillColor("#e8f5e9").opacity(0.15);
    doc.rotate(-30, { origin: [pageWidth / 2, pageHeight / 2] });
    doc.text("NSS", pageWidth / 2 - 100, pageHeight / 2);
    doc.rotate(30).opacity(1);

    doc
      .moveTo(50, pageHeight - 80)
      .lineTo(pageWidth - 50, pageHeight - 80)
      .strokeColor(borderColor)
      .lineWidth(1.2)
      .stroke();
    doc
      .fontSize(10)
      .fillColor("gray")
      .text(
        "Generated automatically by NSS Attendance Management System | AI Insights powered by OpenAI",
        0,
        pageHeight - 65,
        { align: "center" }
      );

    doc.end();

    stream.on("finish", () => {
      res.download(filePath, fileName, () => fs.unlinkSync(filePath));
    });
  } catch (error) {
    console.error("PDF Generation Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// grace mark assigning
// export const assignGraceMark = async (req, res) => {
//   try {
//     const { studentId, eventId, marks } = req.body;

//     const student = await Student.findById(studentId);
//     if (!student) {
//       return res
//         .status(404)
//         .json({ success: false, message: "Student not found" });
//     }

//     // Check if already assigned for this event
//     const alreadyAssigned = student.graceHistory.some(
//       (record) => record.eventId.toString() === eventId
//     );

//     if (alreadyAssigned) {
//       return res.status(400).json({
//         success: false,
//         message: "Grace marks already assigned for this event",
//       });
//     }

//     // Add to history and update total
//     student.graceHistory.push({ eventId, marks });
//     student.graceMarks += Number(marks);

//     await student.save();

//     res.json({ success: true, message: "Grace marks assigned", student });
//   } catch (error) {
//     res.status(500).json({ success: false, message: error.message });
//   }
// };

// export const updateGraceMark = async (req, res) => {
//   try {
//     const { studentId } = req.params;
//     const { marks } = req.body;

//     const student = await Student.findById(studentId);
//     if (!student)
//       return res
//         .status(404)
//         .json({ success: false, message: "Student not found" });

//     student.graceMarks = Number(marks);
//     await student.save();

//     res.json({ success: true, message: "Grace marks updated", student });
//   } catch (error) {
//     res.status(500).json({ success: false, message: error.message });
//   }
// };

// export const deleteGraceMark = async (req, res) => {
//   try {
//     const { studentId } = req.params;
//     const student = await Student.findById(studentId);
//     if (!student)
//       return res
//         .status(404)
//         .json({ success: false, message: "Student not found" });

//     student.graceMarks = 0; // 🧹 reset marks
//     await student.save();

//     res.json({ success: true, message: "Grace marks deleted", student });
//   } catch (error) {
//     res.status(500).json({ success: false, message: error.message });
//   }
// };

// test
export const assignGraceMark = async (req, res) => {
  try {
    const { studentId, eventId, marks } = req.body;

    const student = await Student.findById(studentId);
    if (!student)
      return res
        .status(404)
        .json({ success: false, message: "Student not found" });

    const exists = student.graceHistory.some(
      (h) => h.eventId.toString() === eventId
    );

    if (exists) {
      return res.status(400).json({
        success: false,
        message: "Grace marks already assigned for this event",
      });
    }

    student.graceHistory.push({
      eventId,
      marks: Number(marks),
      date: new Date(),
    });

    await student.save(); // auto recalculates total

    res.json({ success: true, message: "Grace marks assigned", student });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const updateGraceMark = async (req, res) => {
  try {
    const { studentId, eventId } = req.params;
    const { marks } = req.body;

    const student = await Student.findById(studentId);
    if (!student)
      return res
        .status(404)
        .json({ success: false, message: "Student not found" });

    const record = student.graceHistory.find(
      (h) => h.eventId.toString() === eventId
    );

    if (!record)
      return res.status(404).json({
        success: false,
        message: "No grace marks found for this event",
      });

    record.marks = Number(marks);

    await student.save(); // auto recalculates

    res.json({ success: true, message: "Event grace mark updated", student });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteGraceMark = async (req, res) => {
  try {
    const { studentId, eventId } = req.params;

    const student = await Student.findById(studentId);
    if (!student)
      return res
        .status(404)
        .json({ success: false, message: "Student not found" });

    student.graceHistory = student.graceHistory.filter(
      (h) => h.eventId.toString() !== eventId
    );

    await student.save(); // auto recalculates

    res.json({
      success: true,
      message: "Grace mark removed for event",
      student,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// gracemark recommended by coordinator approve
// ✅ Approve or reject a pending grace mark recommendation
// export const approveRecommendedGraceMark = async (req, res) => {
//   try {
//     const { studentId, approve } = req.body;

//     const student = await Student.findById(studentId);
//     if (!student || !student.pendingGraceRecommendation) {
//       return res.status(404).json({
//         success: false,
//         message: "No pending grace mark recommendation found",
//       });
//     }

//     // If approved — add marks and store in grace history
//     if (approve) {
//       const { marks } = student.pendingGraceRecommendation;
//       const { recommendedBy } = student.pendingGraceRecommendation;

//       student.graceMarks += Number(marks);

//       // Add to grace history
//       student.graceHistory.push({
//         eventId: null, // Optional: you can include eventId if it’s linked to a specific event
//         marks: Number(marks),
//         date: new Date(),
//       });

//       // Update recommendation status
//       student.pendingGraceRecommendation.status = "approved";
//       console.log(student.pendingGraceRecommendation.status)

//       await student.save();

//       return res.json({
//         success: true,
//         message: "Grace marks approved and added successfully",
//         student,
//       });
//     } else {
//       // If rejected
//       student.pendingGraceRecommendation.status = "rejected";
//       await student.save();

//       return res.json({
//         success: true,
//         message: "Grace mark recommendation rejected",
//         student,
//       });
//     }
//   } catch (error) {
//     console.error("Error approving/rejecting grace mark:", error);
//     res.status(500).json({ success: false, message: "Action failed" });
//   }
// };

export const approveRecommendedGraceMark = async (req, res) => {
  try {
    const { studentId, approve } = req.body;

    if (!studentId) {
      return res
        .status(400)
        .json({ success: false, message: "Student ID required" });
    }

    const teacher = await Teacher.findById(req.user._id);
    if (!teacher) {
      return res
        .status(403)
        .json({ success: false, message: "Unauthorized teacher" });
    }

    const student = await Student.findById(studentId);
    if (!student || !student.pendingGraceRecommendation) {
      return res.status(404).json({
        success: false,
        message: "No pending grace mark recommendation found for this student",
      });
    }

    if (
      !student.pendingGraceRecommendation.assignedTeachers.includes(
        req.user._id.toString()
      )
    ) {
      return res.status(403).json({
        success: false,
        message: "You are not assigned to review this recommendation",
      });
    }

    // ✅ Update status & log review
    student.pendingGraceRecommendation.status = approve
      ? "approved"
      : "rejected";
    student.pendingGraceRecommendation.reviewedBy = req.user._id;
    student.pendingGraceRecommendation.reviewedDate = new Date();

    // ✅ If approved, add to graceMarks and history
    if (approve) {
      student.graceMarks =
        (student.graceMarks || 0) + student.pendingGraceRecommendation.marks;

      student.graceHistory.push({
        marks: student.pendingGraceRecommendation.marks,
        reason: student.pendingGraceRecommendation.reason,
        approvedBy: req.user._id,
        date: new Date(),
        status: "approved",
      });
    } else {
      student.graceHistory.push({
        marks: student.pendingGraceRecommendation.marks,
        reason: student.pendingGraceRecommendation.reason,
        approvedBy: req.user._id,
        date: new Date(),
        status: "rejected",
      });
    }

    await student.save();

    // ✅ Update coordinator’s log
    await Coordinator.updateOne(
      {
        _id: student.pendingGraceRecommendation.recommendedBy,
        "graceRecommendations.student": student._id,
      },
      {
        $set: {
          "graceRecommendations.$.status": approve ? "approved" : "rejected",
        },
      }
    );

    // ⚠️ DO NOT remove pendingGraceRecommendation
    // Keep it for record/history, so coordinators can see status

    res.status(200).json({
      success: true,
      message: `Grace mark ${approve ? "approved" : "rejected"} successfully`,
      student,
    });
  } catch (error) {
    console.error("Approve grace mark error:", error);
    res
      .status(500)
      .json({ success: false, message: "Server error: " + error.message });
  }
};

/////////////////////////Admin dahboard(approval get and reject)///////////////////////////////////////////////

// get pending teachers
export const getAllPendingTeacher = async (req, res) => {
  try {
    const pendingTeachers = await Teacher.find({ status: "pending" }).select(
      "-password -otp -otpExpiry"
    );
    if (!pendingTeachers) {
      return res
        .status(404)
        .json({ success: false, message: "Teacher not found" });
    }

    res.json({
      success: true,
      count: pendingTeachers.length,
      teachers: pendingTeachers,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// approve teacher(admin)
export const approveTeacher = async (req, res) => {
  try {
    const { id } = req.params;
    const teacher = await Teacher.findById(id);
    if (!teacher) {
      return res
        .status(404)
        .json({ success: false, message: "Teacher not found" });
    }
    teacher.status = "active";
    teacher.verifiedByAdmin = true;
    await teacher.save();
    res.json({
      success: true,
      message: "Teacher has been approved successfully",
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// reject teacher(admin)
export const rejectPendingTeacher = async (req, res) => {
  try {
    const { id } = req.params;
    const teacher = await Teacher.findById(id);
    if (!teacher) {
      return res
        .status(404)
        .json({ success: false, message: "Teacher not found" });
    }
    teacher.status = "rejected";
    if (teacher.profileImage?.public_id) {
      await cloudinary.uploader.destroy(teacher.profileImage.public_id);
    }
    teacher.verifiedByAdmin = false;
    await teacher.save();
    res.json({
      success: true,
      message: "Teacher has been Rejected successfully",
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getAllTeacher = async (req, res) => {
  try {
    const teachers = await Teacher.find()
      .select("-password -otp -otpExpiry") // don’t return sensitive data
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      count: teachers.length,
      teachers,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const rejectInDashboardTeacher = async (req, res) => {
  try {
    const teacher = await Teacher.findByIdAndUpdate(
      req.params.id,
      { status: "rejected" },
      { new: true }
    );
    if (!teacher)
      return res
        .status(404)
        .json({ success: false, message: "Student not found" });
    res.json({
      success: true,
      message: "teacher rejected successfully",
      teacher,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const teacherOverview = async (req, res) => {
  try {
    const teacherId = req.user._id; // assuming added by JWT middleware
    const teacher = await Teacher.findById(teacherId).populate("institution");

    if (!teacher) {
      return res.status(404).json({
        success: false,
        message: "Teacher not found",
      });
    }

    const institutionId = teacher.institution?._id;
    if (!institutionId) {
      return res.status(400).json({
        success: false,
        message: "Teacher is not linked to any institution",
      });
    }

    // 🔹 Fetch institution events
    const institutionEvents = await Event.find({ institution: institutionId });

    // 🔹 Fetch events assigned specifically to this teacher
    const assignedEvents = await Event.find({
      assignedTeacher: teacherId,
    }).sort({ createdAt: -1 });

    // 🔹 Event Stats
    const totalEvents = assignedEvents.length;
    const completedEvents = assignedEvents.filter(
      (e) => e.status?.toLowerCase() === "completed"
    ).length;
    const upcomingEvents = assignedEvents.filter(
      (e) => e.status?.toLowerCase() === "upcoming"
    ).length;

    // 🔹 Students under same institution
    const students = await Student.find({ institution: institutionId });
    const totalStudents = students.length;
    const volunteers = students.filter(
      (s) => s.role?.toLowerCase() === "volunteer"
    ).length;

    // 🔹 Grace Mark Recommendations
    // --- Grace Mark Recommendations ---
    // --- Grace Mark Recommendations ---
    const recommendations = students.filter((s) => {
      const rec = s.pendingGraceRecommendation;
      if (!rec || !rec.assignedTeachers || !Array.isArray(rec.assignedTeachers))
        return false;

      // check if teacher is in assignedTeachers array
      return rec.assignedTeachers.some(
        (t) => t.toString() === teacherId.toString()
      );
    });

    // total recommendation count for this teacher
    const totalRecommendations = recommendations.length;

    // status-based filtering
    const pendingRecommendations = recommendations.filter(
      (s) => s.pendingGraceRecommendation.status?.toLowerCase() === "pending"
    ).length;

    const approvedRecommendations = recommendations.filter(
      (s) => s.pendingGraceRecommendation.status?.toLowerCase() === "approved"
    ).length;

    const rejectedRecommendations = recommendations.filter(
      (s) => s.pendingGraceRecommendation.status?.toLowerCase() === "rejected"
    ).length;

    // 🔹 Grace marks given (approved)
    const graceMarksGiven = approvedRecommendations;

    // 🔹 Recent Events (limit 5)
    const recentEvents = assignedEvents.slice(0, 5).map((event) => ({
      _id: event._id,
      title: event.title,
      description: event.description,
      date: event.date,
      location: event.location,
      status: event.status,
      hours: event.hours,
      createdAt: event.createdAt,
    }));

    // 🔹 Prepare overview response
    const overview = {
      teacherName: teacher.name,
      institutionName: teacher.institution?.name || "N/A",
      totalStudents,
      volunteers,
      totalEvents,
      completedEvents,
      upcomingEvents,
      institutionEvents: institutionEvents.length,
      graceMarksGiven,
      graceMarkStats: {
        total: totalRecommendations,
        pending: pendingRecommendations,
        approved: approvedRecommendations,
        rejected: rejectedRecommendations,
      },
      recentEvents,
    };

    return res.status(200).json({
      success: true,
      data: overview,
    });
  } catch (error) {
    console.error("❌ Error in teacherOverview:", error);
    res.status(500).json({
      success: false,
      message: "Server error. Please try again later.",
      error: error.message,
    });
  }
};

// pending recomendtaion
// ✅ Get all pending grace mark recommendations assigned to a teacher
export const getPendingRecommendations = async (req, res) => {
  try {
    const teacherId = req.user._id;

    // Find all students where this teacher is assigned in recommendation
    const students = await Student.find({
      "pendingGraceRecommendation.assignedTeachers": teacherId,
      "pendingGraceRecommendation.status": "pending",
    })
      .populate("pendingGraceRecommendation.recommendedBy", "name email")
      .select("name email department pendingGraceRecommendation");

    // Format the response
    const data = students.map((student) => ({
      id: student._id,
      name: student.name,
      email: student.email,
      department: student.department,
      marks: student.pendingGraceRecommendation.marks,
      reason: student.pendingGraceRecommendation.reason,
      recommendedBy:
        student.pendingGraceRecommendation.recommendedBy?.name || "N/A",
      status: student.pendingGraceRecommendation.status,
      date: student.pendingGraceRecommendation.date,
    }));

    res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("Error fetching pending recommendations:", error);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch recommendations" });
  }
};

// get events assigned to teacher
export const getMyEvents = async (req, res) => {
  try {
    const teacherId = req.user._id;

    const events = await Event.find({ assignedTeacher: teacherId })
      .populate("institution", "name")
      .sort({ date: -1 });

    if (!events.length) {
      return res
        .status(200)
        .json({ success: true, data: [], message: "No events found" });
    }

    const formatted = events.map((e) => ({
      _id: e._id,
      title: e.title,
      date: e.date,
      description: e.description,
      location: e.location,
      status: e.status,
      hours: e.hours,
      institution: e.institution?.name,
    }));

    res.status(200).json({ success: true, data: formatted });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ===============================
// 📸 Upload Event Images
// ===============================
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

// ===============================
// ✏️ Edit Event Details
// ===============================
export const editEvent = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      title,
      description,
      date,
      location,
      hours,
      status,
      assignedTeacher,
      assignedCoordinators,
    } = req.body;

    const event = await Event.findById(id);
    if (!event) {
      return res
        .status(404)
        .json({ success: false, message: "Event not found" });
    }

    // update editable fields
    if (title) event.title = title;
    if (description) event.description = description;
    if (date) event.date = date;
    if (location) event.location = location;
    if (hours) event.hours = hours;
    if (status) event.status = status;
    if (assignedTeacher) event.assignedTeacher = assignedTeacher;
    if (assignedCoordinators) event.assignedCoordinators = assignedCoordinators;

    await event.save();

    return res.status(200).json({
      success: true,
      message: "Event updated successfully",
      event,
    });
  } catch (error) {
    console.error("❌ Error editing event:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==============================
// 🟢 Get Teacher Profile
// ==============================
export const getTeacherProfile = async (req, res) => {
  try {
    const teacherId = req.user._id; // ✅ from auth middleware

    const teacher = await Teacher.findById(teacherId).select(
      "-password -otp -otpExpiry -__v"
    );

    if (!teacher) {
      return res
        .status(404)
        .json({ success: false, message: "Teacher not found" });
    }

    res.status(200).json({
      success: true,
      message: "Teacher profile fetched successfully",
      teacher,
    });
  } catch (error) {
    console.error("Error fetching teacher profile:", error);
    res
      .status(500)
      .json({ success: false, message: "Server error", error: error.message });
  }
};

// ==============================
// 🟡 Update Teacher Profile
// ==============================
export const updateTeacherProfile = async (req, res) => {
  try {
    const teacherId = req.user._id;
    const { name, email, phoneNumber, department } = req.body;

    const updateData = { name, email, phoneNumber, department };

    // ✅ If profile image is updated
    if (req.file) {
      const result = await cloudinary.uploader.upload(req.file.path, {
        folder: "teacher_profiles",
      });
      updateData.profileImage = {
        url: result.secure_url,
        public_id: result.public_id,
      };
    }

    // ✅ Update teacher info
    const updatedTeacher = await Teacher.findByIdAndUpdate(
      teacherId,
      updateData,
      { new: true }
    ).select("-password -otp -otpExpiry -__v");

    if (!updatedTeacher) {
      return res
        .status(404)
        .json({ success: false, message: "Teacher not found" });
    }

    res.status(200).json({
      success: true,
      message: "Teacher profile updated successfully",
      teacher: updatedTeacher,
    });
  } catch (error) {
    console.error("Error updating teacher profile:", error);
    res
      .status(500)
      .json({ success: false, message: "Server error", error: error.message });
  }
};

// GET participants of a specific event with event-wise grace marks
export const getParticipantsOfEvent = async (req, res) => {
  try {
    const { eventId } = req.params;

    const event = await Event.findById(eventId);
    if (!event) {
      return res
        .status(404)
        .json({ success: false, message: "Event not found" });
    }

    // Fetch only students assigned to this event
    const participants = await Student.find({
      assignedEvents: eventId,
    })
      .select("name email department graceHistory assignedEvents")
      .populate("graceHistory.eventId", "_id title")
      .lean();
    

    return res.json({ success: true, participants });
  } catch (err) {
    console.error("Error fetching participants:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};
