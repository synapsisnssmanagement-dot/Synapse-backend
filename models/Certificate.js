import mongoose from "mongoose";

const certificateSchema = new mongoose.Schema(
  {
    certId: { type: String, required: true, unique: true, index: true },
    student: { type: mongoose.Schema.Types.ObjectId, ref: "student", required: true },
    event: { type: mongoose.Schema.Types.ObjectId, ref: "Event", required: true },
    institution: { type: mongoose.Schema.Types.ObjectId, ref: "Institution" },
    studentName: String,
    department: String,
    eventTitle: String,
    eventDate: Date,
    hours: { type: Number, default: 0 },
    issuedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// One certificate per student per event: re-downloading reuses the same certId.
certificateSchema.index({ student: 1, event: 1 }, { unique: true });

export default mongoose.model("Certificate", certificateSchema);
