import mongoose from "mongoose";

const TeacherSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    phoneNumber: { type: String, required: true },
    department: { type: String, required: true },
    password: { type: String, required: true },
    otp: { type: Number },
    otpExpiry: { type: Date },

    profileImage: {
      url: { type: String, default: "" },
      public_id: { type: String, default: "" },
    },
    institution: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Institution",
      required: true,
    },

    role: {
      type: String,
      enum: ["teacher"],
      default: "teacher",
    },

    verificationDocument: {
      url: { type: String, default: "" },
      public_id: { type: String, default: "" },
    },

    status: {
      type: String,
      enum: ["pending", "active", "rejected"],
      default: "pending",
    },

    assignedEvents: [{ type: mongoose.Schema.Types.ObjectId, ref: "Events" }],

    verifiedByAdmin: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export default mongoose.model("Teacher", TeacherSchema);
