import mongoose from "mongoose";

const adminSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    // phoneNumber: { type: String, required: true },
    // department: { type: String, required: true },
    googleId: { type: String },
    password: { type: String },
    role: {
      type: String,
      enum: ["admin", "superadmin"],
      default: "admin",
    },
    status: {
      type: String,
      enum: ["active", "inactive", "pending"],
      default: "pending",
    },
    otp: { type: Number },
    otpExpiry: { type: Date },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model("Admin", adminSchema);
