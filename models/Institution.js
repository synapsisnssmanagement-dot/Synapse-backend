import mongoose from "mongoose";

const institutionSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    address: {
      type: String,
      trim: true,
    },
    contactEmail: {
      type: String,
      trim: true,
      lowercase: true,
    },
    phoneNumber: {
      type: String,
      trim: true,
    },
    // If you want to associate coordinators, students, etc.
    coordinators: [
      { type: mongoose.Schema.Types.ObjectId, ref: "Coordinator" },
    ],
    students: [{ type: mongoose.Schema.Types.ObjectId, ref: "Student" }],
    teacher: [{ type: mongoose.Schema.Types.ObjectId, ref: "Teacher" }],
    Events: [{ type: mongoose.Schema.Types.ObjectId, ref: "Event" }],
  },
  { timestamps: true }
);

export default mongoose.model("Institution", institutionSchema);
