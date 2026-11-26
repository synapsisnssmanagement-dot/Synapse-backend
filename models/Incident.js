import mongoose from "mongoose";

// Restricted incident register. Readable only by Programme Officers and the
// supervisors of the related camp/activity; reporters see their own report.
const incidentSchema = new mongoose.Schema(
  {
    institution: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    camp: { type: mongoose.Schema.Types.ObjectId, ref: "CampPlan" },
    event: { type: mongoose.Schema.Types.ObjectId, ref: "Event" },
    occurredAt: { type: Date, required: true },
    category: { type: String, enum: ["health", "injury", "safety", "conduct", "property", "other"], required: true },
    severity: { type: String, enum: ["low", "medium", "high"], required: true },
    description: { type: String, required: true, maxlength: 4000 },
    actionsTaken: { type: String, maxlength: 4000, default: "" },
    involved: [{ type: mongoose.Schema.Types.ObjectId, ref: "student" }],
    reportedBy: { type: mongoose.Schema.Types.ObjectId, required: true },
    reporterRole: String,
    status: { type: String, enum: ["open", "closed"], default: "open" },
    updates: [{ by: mongoose.Schema.Types.ObjectId, note: String, at: { type: Date, default: Date.now } }],
  },
  { timestamps: true }
);

export default mongoose.model("Incident", incidentSchema);
