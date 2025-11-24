// import jwt from "jsonwebtoken";
// import bcrypt from "bcrypt";
// import Alumni from "../models/Alumni.js";
// import { sendEmail } from "../utils/sendEmail.js";
// import cloudinary from "../utils/cloudinary.js";

// const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// const passwordRegex =
//   /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;

// const genrateToken = (id) =>
//   jwt.sign({ id, role: "alumni" }, process.env.JWT_SECRET, { expiresIn: "7d" });

// const otpGeneration = () => Math.floor(100000 + Math.random() * 900000);

// // signup
// export const Signup = async (req, res) => {
//   try {
//     const { name, email, password, phoneNumber, graduationYear, department } =
//       req.body;

//     if (!emailRegex.test(email)) {
//       return res
//         .status(400)
//         .json({ success: false, message: "Invalid email format" });
//     }

//     if (!passwordRegex.test(password)) {
//       return res.status(400).json({
//         success: false,
//         message:
//           "Password must be 8+ chars, include uppercase, lowercase, number, special characters",
//       });
//     }

//     const exists = await Alumni.findOne({ email: email });
//     if (exists) {
//       return res
//         .status(400)
//         .json({ success: false, message: "Alumni already existed" });
//     }

//     let profileImage = {};
//     if (req.file) {
//       profileImage = { url: req.file.path, public_id: req.file.filename };
//     }

//     const otp = otpGeneration();
//     const otpExpiry = Date.now() + 5 * 60 * 1000;
//     const hashedPassword = await bcrypt.hash(password, 10);

//     const alumni = await Alumni.create({
//       name,
//       email,
//       password: hashedPassword,
//       phoneNumber,
//       graduationYear,
//       department,
//       profileImage,
//       otp,
//       otpExpiry,
//       status: "pending",
//     });

//     // passing argument from alrady mention to,subject and text is passed as argument here
//     await sendEmail(email, "Verify your Alumni account", `Your OTP:${otp}`);
//     res.status(201).json({
//       success: true,
//       message: "Signup successful.OTP sent to email",
//       alumniId: alumni._id,
//     });
//   } catch (error) {
//     res.status(500).json({ success: false, message: error.message });
//   }
// };

// // verify otp
// export const verifyOtp = async (req, res) => {
//   try {
//     const { otp } = req.body; // OTP comes from body
//     const alumni = await Alumni.findById(req.params.id); // ID comes from URL params
//     if (!alumni) {
//       return res
//         .status(404)
//         .json({ success: false, message: "Alumni not found" });
//     }

//     if (alumni.otp !== otp || alumni.otpExpiry < Date.now()) {
//       return res
//         .status(400)
//         .json({ success: false, message: "Invalid or expired OTP" });
//     }

//     alumni.otp = null;
//     alumni.otpExpiry = null;
//     await alumni.save();

//     res.json({
//       success: true,
//       message: "OTP verified. Now wait for admin approval",
//     });
//   } catch (error) {
//     res.status(500).json({ success: false, message: error.message });
//   }
// };

// // Login
// export const Login = async (req, res) => {
//   try {
//     const { email, password } = req.body;
//     const alumni = await Alumni.findOne({ email });
//     if (!alumni) {
//       return res
//         .status(404)
//         .json({ success: false, message: "Alunmni is not found" });
//     }
//     if (alumni.status !== "active") {
//       return res
//         .status(403)
//         .json({ success: false, message: "Account is not active yet" });
//     }

//     const match = await bcrypt.compare(password, alumni.password);
//     if (!match) {
//       return res
//         .status(403)
//         .json({ success: false, message: "Invalid credentials" });
//     }
//     const token = genrateToken(alumni._id);
//     res.json({ success: true, message: "Login successful", token, alumni });
//   } catch (error) {
//     res.status(500).json({ success: false, message: error.message });
//   }
// };

// // approve alumni
// export const approveAlumni = async (req, res) => {
//   try {
//     const alumni = await Alumni.findById(req.params.id);
//     if (!alumni) {
//       return res
//         .status(404)
//         .json({ success: false, message: "Alumni not found" });
//     }

//     alumni.status = "active";
//     await alumni.save();
//     res.json({ success: true, message: "Alumni approved", alumni });
//   } catch (error) {
//     res.status(500).json({ success: false, message: error.message });
//   }
// };

// // update alumni
// export const updateAlumni = async (req, res) => {
//   try {
//     const { id } = req.params;
//     const alumni = await Alumni.findById(id);
//     if (!alumni) {
//       return res
//         .status(404)
//         .json({ success: false, message: "Alumni not found" });
//     }

//     const { name, phoneNumber, graduationYear, department } = req.body;
//     if (name) alumni.name = name;
//     if (phoneNumber) alumni.phoneNumber = phoneNumber;
//     if (graduationYear) alumni.graduationYear = graduationYear;
//     if (department) alumni.department = department;

//     if (req.file) {
//       if (alumni.profileImage?.public_id) {
//         await cloudinary.uploader.destroy(alumni.profileImage.public_id);
//       }
//       alumni.profileImage = {
//         url: req.file.path,
//         public_id: req.file.filename,
//       };
//     }

//     await alumni.save();
//     res.json({ success: true, message: "Alumni updated successfully", alumni });
//   } catch (error) {
//     res.status(500).json({ success: false, message: error.message });
//   }
// };

// // delete alumni
// export const deleteAlumni = async (req, res) => {
//   try {
//     const alumni = await Alumni.findById(req.params.id);
//     if (!alumni) {
//       return res
//         .status(404)
//         .json({ success: false, message: "Alumni not found" });
//     }

//     // delete the id of image public_id
//     if (alumni.profileImage?.public_id) {
//       await cloudinary.uploader.destroy(alumni.profileImage.public_id);
//     }

//     await alumni.deleteOne();

//     res.json({ success: true, message: "Alumni deleted successfully!!!" });
//   } catch (error) {
//     res.status(500).json({ success: false, message: error.message });
//   }
// };

// // add testimonial
// export const addTestimonial = async (req, res) => {
//   try {
//     const alumni = await Alumni.findById(req.params.id);
//     if (!alumni) {
//       return res
//         .status(404)
//         .json({ success: false, message: "Alumni not found" });
//     }
//     alumni.testimonials.push({ message: req.body.message });
//     await alumni.save();
//     res.json({ success: true, message: "testimonial submitted" });
//   } catch (error) {
//     res.status(500).json({ success: false, message: error.message });
//   }
// };

// export const updateTestimonialVisibility = async (req, res) => {
//   try {
//     const { id, testimonialId } = req.params; // ✅ route param fix
//     const { visibility } = req.body; // "approved" | "rejected"

//     const alumni = await Alumni.findById(id);
//     if (!alumni) {
//       return res
//         .status(404)
//         .json({ success: false, message: "Alumni not found" });
//     }

//     const testimonial = alumni.testimonials.id(testimonialId);
//     if (!testimonial) {
//       return res
//         .status(404)
//         .json({ success: false, message: "Testimonial not found" });
//     }

//     testimonial.visibility = visibility;
//     await alumni.save();

//     res.json({
//       success: true,
//       message: `Testimonial visibility updated to ${visibility}`,
//       testimonial,
//     });
//   } catch (error) {
//     res.status(500).json({ success: false, message: error.message });
//   }
// };

// // get top 3 testimonials
// export const getTopTestimonial = async (req, res) => {
//   try {
//     const alumni = await Alumni.find({ "testimonials.visibility": "approved" })
//       .select("name department graduationYear profileImage testimonials")
//       .lean();
//     const approvedTestimonials = alumni
//       .flatMap((a) =>
//         a.testimonials
//           .filter((t) => t.visibility === "approved")
//           .map((t) => ({
//             alumniId: a._id,
//             name: a.name,
//             department: a.department,
//             graduationYear: a.graduationYear,
//             profileImage: a.profileImage?.url,
//             message: t.message,
//           }))
//       )
//       .slice(0, 3);
//     res.json({ success: true, testimonials: approvedTestimonials });
//   } catch (error) {
//     res.status(500).json({ success: false, message: error.message });
//   }
// };

// // add achievements
// export const addAchievement = async (req, res) => {
//   try {
//     const alumni = await Alumni.findById(req.params.id);
//     if (!alumni) {
//       return res
//         .status(404)
//         .json({ success: false, message: "Alumni not found" });
//     }
//     alumni.achievements.push({
//       title: req.body.title,
//       description: req.body.description,
//     });

//     await alumni.save();
//     res.json({ success: true, message: "Achievement added" });
//   } catch (error) {
//     res.status(500).json({ success: false, message: error.message });
//   }
// };

import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import Alumni from "../models/Alumni.js";
import { sendEmail } from "../utils/sendEmail.js";
import cloudinary from "../utils/cloudinary.js";
import Mentorship from "../models/Mentorship.js";
import Event from "../models/Event.js";

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const passwordRegex =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;

const generateToken = (id) =>
  jwt.sign({ id, role: "alumni" }, process.env.JWT_SECRET, { expiresIn: "7d" });

const otpGeneration = () => Math.floor(100000 + Math.random() * 900000);

//
// 🧾 SIGNUP (with OTP)
//
export const signupAlumni = async (req, res) => {
  try {
    const {
      name,
      email,
      password,
      phoneNumber,
      graduationYear,
      department,
      institution,
    } = req.body;

    // ✅ Validate email format
    if (!emailRegex.test(email))
      return res
        .status(400)
        .json({ success: false, message: "Invalid email format" });

    // ✅ Validate password
    if (!passwordRegex.test(password))
      return res.status(400).json({
        success: false,
        message:
          "Password must include upper, lower, number & special character (8+ chars).",
      });

    // ✅ Check if alumni already exists
    const exists = await Alumni.findOne({ email });
    if (exists)
      return res
        .status(400)
        .json({ success: false, message: "Alumni already registered." });

    // ✅ Handle profile image upload to Cloudinary
    let profileImage = {};
    if (req.file) {
      const result = await cloudinary.uploader.upload(req.file.path, {
        folder: "alumni_profiles",
      });
      profileImage = {
        url: result.secure_url,
        public_id: result.public_id,
      };
    }

    // ✅ Generate OTP and hash password
    const otp = otpGeneration();
    const otpExpiry = Date.now() + 5 * 60 * 1000;
    const hashedPassword = await bcrypt.hash(password, 10);

    // ✅ Create Alumni
    const alumni = await Alumni.create({
      name,
      email,
      password: hashedPassword,
      phoneNumber,
      graduationYear,
      department,
      institution,
      profileImage,
      otp,
      otpExpiry,
      status: "pending",
      mentorships: [],
      mentorshipStats: {
        totalMentees: 0,
        activeSessions: 0,
        completedSessions: 0,
      },
      mentorshipAvailability: {
        isAvailable: true,
        preferredTopics: [],
        availableSlots: [],
      },
    });

    // ✅ Send verification email
    await sendEmail(email, "Verify your Alumni Account", `Your OTP: ${otp}`);

    res.status(201).json({
      success: true,
      message: "Signup successful! OTP sent to email.",
      // alumniId: alumni._id,
      userId: alumni._id,
      role: "alumni",
    });
  } catch (error) {
    console.error("Signup Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};
//
// 🔐 LOGIN
//
export const loginAlumni = async (req, res) => {
  try {
    const { email, password } = req.body;
    const alumni = await Alumni.findOne({ email });

    if (!alumni)
      return res
        .status(404)
        .json({ success: false, message: "Alumni not found." });

    if (alumni.status !== "active")
      return res.status(403).json({
        success: false,
        message:
          "Your account is not active yet. Please wait for admin approval.",
      });

    const match = await bcrypt.compare(password, alumni.password);
    if (!match)
      return res
        .status(403)
        .json({ success: false, message: "Invalid credentials." });

    const token = generateToken(alumni._id);

    res.json({
      success: true,
      message: "Login successful.",
      token,
      alumni,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

//
// 💬 ADD TESTIMONIAL
//
export const addTestimonial = async (req, res) => {
  try {
    const alumni = await Alumni.findById(req.user.id);
    if (!alumni)
      return res
        .status(404)
        .json({ success: false, message: "Alumni not found." });

    alumni.testimonials.push({ message: req.body.message });
    await alumni.save();

    res.json({ success: true, message: "Testimonial submitted successfully." });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

//
// 🧩 UPDATE TESTIMONIAL VISIBILITY (Admin only)
//
export const updateTestimonialVisibility = async (req, res) => {
  try {
    // ⭐ Admin info from middleware
    const adminId = req.user.id;

    // ⭐ Alumni + testimonial from params
    const { id, testimonialId } = req.params;
    const { visibility } = req.body;

    // Optional: log who approved
    console.log("Approved by admin:", adminId);

    const alumni = await Alumni.findById(id);
    if (!alumni) {
      return res
        .status(404)
        .json({ success: false, message: "Alumni not found." });
    }

    const testimonial = alumni.testimonials.id(testimonialId);
    if (!testimonial) {
      return res
        .status(404)
        .json({ success: false, message: "Testimonial not found." });
    }

    testimonial.visibility = visibility;

    // Optional: store approval details
    testimonial.reviewedBy = adminId;
    testimonial.reviewedAt = new Date();

    await alumni.save();

    return res.json({
      success: true,
      message: `Testimonial marked as ${visibility}`,
      testimonial,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

//
// 🌟 GET TOP 3 APPROVED TESTIMONIALS
//
export const getTopTestimonials = async (req, res) => {
  try {
    const alumni = await Alumni.find({ "testimonials.visibility": "approved" })
      .select("name department graduationYear profileImage testimonials")
      .lean();

    const approvedTestimonials = alumni
      .flatMap((a) =>
        a.testimonials
          .filter((t) => t.visibility === "approved")
          .map((t) => ({
            alumniId: a._id,
            name: a.name,
            department: a.department,
            graduationYear: a.graduationYear,
            profileImage: a.profileImage?.url,
            message: t.message,
          }))
      )
      .slice(0, 3);

    res.json({ success: true, testimonials: approvedTestimonials });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// alumni (approve and reject)
export const getAllPendingAlumni = async (req, res) => {
  try {
    const pendingAlumni = await Alumni.find({ status: "pending" })
      .select("-password -otp -otpExpiry")
      .populate("institution", "name address");

    res.json({
      success: true,
      count: pendingAlumni.length,
      alumni: pendingAlumni,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 🟢 Approve alumni
export const approveAlumni = async (req, res) => {
  try {
    const { id } = req.params;
    const alumni = await Alumni.findById(id);

    if (!alumni) {
      return res
        .status(404)
        .json({ success: false, message: "Alumni Not Found" });
    }

    if (alumni.status === "active") {
      return res
        .status(400)
        .json({ success: false, message: "Alumni Already Active" });
    }

    alumni.status = "active";
    await alumni.save();

    res.json({
      success: true,
      message: `${alumni.name} has been approved successfully`,
      alumni: await alumni.populate("institution", "name address"),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 🔴 Reject alumni (admin panel)
export const rejectAlumni = async (req, res) => {
  try {
    const { id } = req.params;
    const alumni = await Alumni.findById(id);

    if (!alumni) {
      return res
        .status(404)
        .json({ success: false, message: "Alumni Not Found" });
    }

    if (alumni.status === "active") {
      return res
        .status(400)
        .json({ success: false, message: "Alumni Already Active" });
    }

    alumni.status = "rejected";

    // Delete profile image if exists
    if (alumni.profileImage?.public_id) {
      await cloudinary.uploader.destroy(alumni.profileImage.public_id);
    }

    await alumni.save();

    res.json({
      success: true,
      message: `${alumni.name} has been rejected successfully`,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 🟣 Get all alumni (active + rejected + pending)
export const getAllAlumnis = async (req, res) => {
  try {
    const alumnis = await Alumni.find()
      .populate("institution", "name address contactEmail")
      .select("-password -otp -otpExpiry")
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      count: alumnis.length,
      alumnis,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 🔵 Reject alumni directly from dashboard (simplified)
export const rejectInDashboardAlumni = async (req, res) => {
  try {
    const alumni = await Alumni.findByIdAndUpdate(
      req.params.id,
      { status: "rejected" },
      { new: true }
    );

    if (!alumni)
      return res
        .status(404)
        .json({ success: false, message: "Alumni not found" });

    res.json({
      success: true,
      message: "Alumni rejected successfully",
      alumni,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// dashboard
export const getAlumniDashboard = async (req, res) => {
  try {
    const alumniId = req.user.id;

    const alumni = await Alumni.findById(alumniId)
      .select(
        "name email department graduationYear profileImage mentorships achievements testimonials institution"
      )
      .populate("institution", "name address contactEmail")
      .populate({
        path: "mentorships",
        model: "Mentorship", // <-- Ensure model is known
      });

    return res.json({
      success: true,
      data: alumni,
    });
  } catch (error) {
    console.log("Dashboard Error:", error);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

export const getAlumniProfile = async (req, res) => {
  try {
    const alumniId = req.user.id;

    const alumni = await Alumni.findById(alumniId)
      .select("name email department graduationYear profileImage institution")
      .populate("institution", "name address contactEmail");

    if (!alumni) {
      return res
        .status(404)
        .json({ success: false, message: "Alumni not found" });
    }

    return res.json({ success: true, data: alumni });
  } catch (error) {
    console.log("Profile Fetch Error:", error);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

// 📌 UPDATE PROFILE
export const updateAlumniProfile = async (req, res) => {
  try {
    const alumniId = req.user.id;
    const { name, email, department, graduationYear } = req.body;

    let profileImage = {};

    if (req.file) {
      const uploaded = await cloudinary.uploader.upload(req.file.path, {
        folder: "alumni_profiles",
      });

      profileImage = {
        url: uploaded.secure_url,
        public_id: uploaded.public_id,
      };
    }

    const updated = await Alumni.findByIdAndUpdate(
      alumniId,
      {
        name,
        email,
        department,
        graduationYear,
        ...(req.file && { profileImage }),
      },
      { new: true }
    ).populate("institution", "name");

    return res.json({
      success: true,
      message: "Profile updated successfully",
      updated,
    });
  } catch (error) {
    console.log("Profile Update Error:", error);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

// get all testimonials
export const getAllTestimonials = async (req, res) => {
  try {
    const alumnis = await Alumni.find().select(
      "name department graduationYear profileImage testimonials"
    );

    // Flatten testimonials into one clean array
    const result = alumnis.flatMap((alumni) =>
      alumni.testimonials.map((t) => ({
        alumniId: alumni._id,
        testimonialId: t._id,
        name: alumni.name,
        department: alumni.department,
        graduationYear: alumni.graduationYear,
        profileImage: alumni.profileImage?.url,
        message: t.message,
        visibility: t.visibility,
        createdAt: t.createdAt,
      }))
    );

    return res.json({
      success: true,
      testimonials: result,
    });
  } catch (error) {
    console.error("Fetch testimonials error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getAllImages = async (req, res) => {
  try {
    const alumniId = req.user.id;
    const alumni = await Alumni.findById(alumniId);
    if (!alumni) {
      return res
        .status(404)
        .json({ success: false, message: "Alumni Not found" });
    }
    const alumniInstitute = alumni.institution;
    const EventofInstitute = await Event.find({ institution: alumniInstitute });
    const allImages = EventofInstitute.flatMap((event) => event.images || []);
    res.json({ success: true, images: allImages });
  } catch (error) {
    console.error("Fetch testimonials error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};
