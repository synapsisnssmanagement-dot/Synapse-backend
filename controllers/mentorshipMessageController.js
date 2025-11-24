import MentorshipMessage from "../models/MentorshipMessage.js";
import Mentorship from "../models/Mentorship.js";


// ============================================================
// Helper: Check if Alumni Has Access to This Mentorship
// ============================================================
const getMentorshipForAlumni = async (alumniId, mentorshipId) => {
  return await Mentorship.findOne({
    _id: mentorshipId,
    mentor: alumniId,
    status: "active",
  });
};

// ============================================================
// Helper: Check if Student/Volunteer Has Access
// ============================================================
const getMentorshipForStudent = async (userId, mentorshipId) => {
  return await Mentorship.findOne({
    _id: mentorshipId,
    mentee: userId,
    status: "active",
  });
};


/* ============================================================
   ⭐ GET ALL ACTIVE MENTORSHIPS FOR LOGGED-IN USER
   Works for: alumni, student, volunteer
============================================================ */
export const getAllMentorships = async (req, res) => {
  try {
    const userId = req.user.id;
    const role = req.user.role;

    let mentorships = [];

    if (role === "alumni") {
      // Alumni → mentor
      mentorships = await Mentorship.find({
        mentor: userId,
        status: "active",              // ONLY ACTIVE
      })
        .populate("mentee", "name email")
        .sort({ createdAt: -1 });
    } 
    
    else if (role === "student" || role === "volunteer") {
      // Student / Volunteer → mentee
      mentorships = await Mentorship.find({
        mentee: userId,
        status: "active",              // ONLY ACTIVE
      })
        .populate("mentor", "name email")
        .sort({ createdAt: -1 });
    } 
    
    else {
      return res.status(403).json({ message: "Invalid user role" });
    }

    return res.json({
      success: true,
      total: mentorships.length,
      mentorships,
    });

  } catch (err) {
    console.error("❌ Get ALL Mentorship Error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* ============================================================
   📌 STUDENT — GET MESSAGES
============================================================ */
export const getStudentMessages = async (req, res) => {
  try {
    const userId = req.user.id;
    const mentorshipId = req.params.mentorshipId;

    if (!mentorshipId)
      return res.status(400).json({ message: "Mentorship ID is required" });

    const mentorship = await getMentorshipForStudent(userId, mentorshipId);
    if (!mentorship)
      return res.status(403).json({ message: "Access denied" });

    const messages = await MentorshipMessage.find({
      mentorship: mentorshipId,
    }).sort({ createdAt: 1 });

    return res.json({
      success: true,
      mentorshipId,
      messages,
    });
  } catch (err) {
    console.error("Get Student Messages Error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* ============================================================
   📌 STUDENT — SEND MESSAGE
============================================================ */
export const sendStudentMessage = async (req, res) => {
  try {
    const userId = req.user.id;
    const role = req.user.role;
    const mentorshipId = req.params.mentorshipId;
    const { message } = req.body;

    if (!mentorshipId)
      return res.status(400).json({ message: "Mentorship ID is required" });

    if (!message?.trim())
      return res.status(400).json({ message: "Message cannot be empty" });

    const mentorship = await getMentorshipForStudent(userId, mentorshipId);
    if (!mentorship)
      return res.status(403).json({ message: "Access denied" });

    const newMessage = await MentorshipMessage.create({
      mentorship: mentorshipId,
      senderId: userId,
      senderRole: role, // student or volunteer
      message,
    });

    return res.json({ success: true, newMessage });

  } catch (err) {
    console.error("Send Student Message Error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* ============================================================
   📌 ALUMNI — GET MESSAGES
============================================================ */
export const getAlumniMessages = async (req, res) => {
  try {
    const userId = req.user.id;
    const mentorshipId = req.params.mentorshipId;

    if (!mentorshipId)
      return res.status(400).json({ message: "Mentorship ID is required" });

    const mentorship = await getMentorshipForAlumni(userId, mentorshipId);
    if (!mentorship)
      return res.status(403).json({ message: "Access denied" });

    const messages = await MentorshipMessage.find({
      mentorship: mentorshipId,
    }).sort({ createdAt: 1 });

    return res.json({
      success: true,
      mentorshipId,
      messages,
    });
  } catch (err) {
    console.error("Get Alumni Messages Error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* ============================================================
   📌 ALUMNI — SEND MESSAGE
============================================================ */
export const sendAlumniMessage = async (req, res) => {
  try {
    const userId = req.user.id;
    const mentorshipId = req.params.mentorshipId;
    const { message } = req.body;

    if (!mentorshipId)
      return res.status(400).json({ message: "Mentorship ID is required" });

    if (!message?.trim())
      return res.status(400).json({ message: "Message cannot be empty" });

    const mentorship = await getMentorshipForAlumni(userId, mentorshipId);
    if (!mentorship)
      return res.status(403).json({ message: "Access denied" });

    const newMessage = await MentorshipMessage.create({
      mentorship: mentorshipId,
      senderId: userId,
      senderRole: "alumni",
      message,
    });

    return res.json({ success: true, newMessage });

  } catch (err) {
    console.error("Send Alumni Message Error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
