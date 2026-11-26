import mongoose from "mongoose";

// Programme Officer handover. The pending-items snapshot is computed when the
// handover is created; the incoming officer acknowledges it.
const handoverSchema = new mongoose.Schema(
  {
    institution: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    unit: { type: mongoose.Schema.Types.ObjectId, ref: "NssUnit" },
    fromOfficer: { type: mongoose.Schema.Types.ObjectId, ref: "Coordinator", required: true },
    toOfficer: { type: mongoose.Schema.Types.ObjectId, ref: "Coordinator", required: true },
    effectiveDate: { type: Date, required: true },
    notes: { type: String, maxlength: 8000, default: "" },
    checklist: [{ item: String, done: { type: Boolean, default: false } }],
    snapshot: { type: mongoose.Schema.Types.Mixed, required: true },
    status: { type: String, enum: ["prepared", "acknowledged"], default: "prepared" },
    acknowledgedAt: Date,
    acknowledgementNote: String,
  },
  { timestamps: true }
);

export default mongoose.model("Handover", handoverSchema);
