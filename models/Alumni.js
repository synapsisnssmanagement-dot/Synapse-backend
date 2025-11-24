import mongoose from "mongoose";

const alumniSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    phoneNumber: { type: String, required: true },
    graduationYear: { type: String, required: true },
    department: { type: String, required: true },

    otp: { type: Number },
    otpExpiry: { type: Date },

    status: {
      type: String,
      enum: ["pending", "active", "rejected"],
      default: "pending",
    },

    role: {
      type: String,
      enum: ["alumni"], // For clarity and consistency
      default: "alumni",
    },

    profileImage: {
      url: { type: String },
      public_id: { type: String },
    },

    institution: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Institution",
      required: true,
    },

    testimonials: [
      {
        message: String,
        visibility: {
          type: String,
          enum: ["pending", "approved", "rejected"],
          default: "pending",
        },
      },
    ],

    achievements: [
      {
        title: String,
        description: String,
        date: { type: Date, default: Date.now },
        verified: { type: Boolean, default: false },
      },
    ],

    mentorships: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Mentorship",
      },
    ],

    // mentorshipStats: {
    //   totalMentees: { type: Number, default: 0 },
    //   activeSessions: { type: Number, default: 0 },
    //   completedSessions: { type: Number, default: 0 },
    // },

    mentorshipAvailability: {
      isAvailable: { type: Boolean, default: true },
      preferredTopics: [{ type: String }],
      availableSlots: [
        {
          day: { type: String }, // e.g., "Monday"
          time: { type: String }, // e.g., "10:00 AM - 12:00 PM"
        },
      ],
    },
  },
  { timestamps: true }
);

export default mongoose.model("Alumni", alumniSchema);
