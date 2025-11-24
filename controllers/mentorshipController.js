import Mentorship from "../models/Mentorship.js";
import Alumni from "../models/Alumni.js";
import Student from "../models/Student.js";

// ================================================
// ⭐ STUDENT REQUEST MENTORSHIP
// ================================================
export const requestMentorship = async (req, res) => {
  try {
    const { mentorId, topic, description } = req.body;
    const studentId = req.user.id;

    if (!mentorId || !topic) {
      return res.status(400).json({ message: "Mentor ID and topic are required" });
    }

    const mentorship = await Mentorship.create({
      mentor: mentorId,
      mentee: studentId,
      topic,
      description,
      status: "pending",
    });

    await Alumni.findByIdAndUpdate(mentorId, {
      $push: { mentorships: mentorship._id },
    });

    return res.status(201).json({
      success: true,
      message: "Mentorship request sent successfully",
      mentorship,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ================================================
// ⭐ MENTOR GET ALL REQUESTS ASSIGNED TO THEM
// ================================================
export const getMentorRequests = async (req, res) => {
  try {
    const mentorId = req.user.id;

    const requests = await Mentorship.find({ mentor: mentorId })
      .populate("mentee", "name email department profileImage")
      .sort({ createdAt: -1 });

    return res.json({ success: true, requests });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ================================================
// ⭐ STUDENT GET THEIR OWN REQUESTS
// ================================================
export const getStudentMentorships = async (req, res) => {
  try {
    const studentId = req.user.id;

    const sessions = await Mentorship.find({ mentee: studentId })
      .populate("mentor", "name email department profileImage")
      .sort({ createdAt: -1 });

    return res.json({ success: true, sessions });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ================================================
// ⭐ MENTOR ACCEPT / REJECT REQUEST
// ================================================
export const respondToRequest = async (req, res) => {
  try {
    const { status } = req.body;
    const { mentorshipId } = req.params;
    const mentorId = req.user.id;

    if (!["active", "rejected"].includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    const mentorship = await Mentorship.findOneAndUpdate(
      { _id: mentorshipId, mentor: mentorId },
      { status },
      { new: true }
    );

    if (!mentorship) {
      return res.status(404).json({ message: "Mentorship not found" });
    }

    return res.json({
      success: true,
      message: `Mentorship ${status}`,
      mentorship,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ================================================
// ⭐ START MENTORSHIP SESSION
// ================================================
export const startSession = async (req, res) => {
  try {
    const { mentorshipId } = req.params;
    const mentorId = req.user.id;

    const session = await Mentorship.findOneAndUpdate(
      { _id: mentorshipId, mentor: mentorId, status: "active" },
      { startDate: new Date() },
      { new: true }
    );

    if (!session) return res.status(404).json({ message: "Session not found" });

    return res.json({ success: true, session });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ================================================
// ⭐ END SESSION (MENTOR FEEDBACK OPTIONAL)
// ================================================
export const endSession = async (req, res) => {
  try {
    const { mentorshipId } = req.params;
    const { rating, comment } = req.body;
    const mentorId = req.user.id;

    const session = await Mentorship.findOneAndUpdate(
      { _id: mentorshipId, mentor: mentorId },
      {
        status: "completed",
        endDate: new Date(),
        mentorFeedback: { rating, comment },
      },
      { new: true }
    );

    return res.json({ success: true, session });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ================================================
// ⭐ STUDENT FEEDBACK
// ================================================
export const addMenteeFeedback = async (req, res) => {
  try {
    const { mentorshipId } = req.params;
    const { rating, comment } = req.body;
    const studentId = req.user.id;

    const session = await Mentorship.findOneAndUpdate(
      { _id: mentorshipId, mentee: studentId },
      { menteeFeedback: { rating, comment } },
      { new: true }
    );

    return res.json({ success: true, session });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ================================================
// ⭐ UPDATE MEETING LINK
// ================================================
export const updateMeetingLink = async (req, res) => {
  try {
    const { mentorshipId } = req.params;
    const { link } = req.body;
    const mentorId = req.user.id;

    const session = await Mentorship.findOneAndUpdate(
      { _id: mentorshipId, mentor: mentorId },
      { meetingLink: link },
      { new: true }
    );

    return res.json({ success: true, session });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
};

// get all mentors of the institute
export const getAvailableMentors = async (req, res) => {
  try {
    const studentId = req.user.id;

    // 1️⃣ Find student by ID
    const student = await Student.findById(studentId).select("institution");

    if (!student) {
      return res.status(404).json({ message: "Student not found" });
    }

    const institutionId = student.institution;

    // 2️⃣ Find alumni mentors in same institution
    const mentors = await Alumni.find({
      institution: institutionId,
      status: "active",
      "mentorshipAvailability.isAvailable": true,
    }).select("name email department profileImage mentorshipAvailability");

    return res.json({
      success: true,
      mentors,
    });
  } catch (err) {
    console.error("Error fetching mentors:", err.message);
    return res.status(500).json({ message: "Server error" });
  }
};


export const getAllMenteeFeedback = async (req, res) => {
  try {
    const mentorId = req.user.id; // logged-in alumni user

    // Find all completed mentorships belonging to this mentor,
    // where mentee feedback exists
    const mentorships = await Mentorship.find({
      mentor: mentorId,
      status: "completed",
      "menteeFeedback.rating": { $exists: true }
    })
      .populate("mentee", "name email")
      .populate("mentor", "name email")
      .sort({ updatedAt: -1 });

    return res.json({
      success: true,
      count: mentorships.length,
      feedbacks: mentorships.map((m) => ({
        mentorshipId: m._id,
        topic: m.topic,
        description: m.description,
        mentee: m.mentee,
        feedback: m.menteeFeedback,
        completedAt: m.endDate,
      })),
    });

  } catch (err) {
    console.error("Error fetching mentee feedback:", err);
    res.status(500).json({ message: "Server error" });
  }
};
