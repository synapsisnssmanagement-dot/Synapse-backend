import mongoose from "mongoose";

// Volunteer complaint about hours. Resolution never edits credits itself:
// an upheld complaint links to a ledger adjustment created through the ledger.
const grievanceSchema = new mongoose.Schema(
  {
    institution: { type: mongoose.Schema.Types.ObjectId, ref: "Institution", required: true, index: true },
    student: { type: mongoose.Schema.Types.ObjectId, ref: "student", required: true, index: true },
    type: {
      type: String,
      enum: ["missing_attendance", "missing_hours", "incorrect_duration", "category", "returned_or_rejected"],
      required: true,
    },
    event: { type: mongoose.Schema.Types.ObjectId, ref: "Event" },
    diary: { type: mongoose.Schema.Types.ObjectId, ref: "DiaryEntry" },
    ledgerEntry: { type: mongoose.Schema.Types.ObjectId, ref: "LedgerEntry" },
    explanation: { type: String, trim: true, required: true, maxlength: 4000 },
    evidence: [{ label: String, url: String }],
    deadline: { type: Date, required: true },
    assignedTo: { type: mongoose.Schema.Types.ObjectId },
    status: { type: String, enum: ["open", "under_review", "upheld", "dismissed", "escalated", "withdrawn"], default: "open", index: true },
    history: [
      {
        action: String,
        by: mongoose.Schema.Types.ObjectId,
        byRole: String,
        note: String,
        at: { type: Date, default: Date.now },
      },
    ],
    resolution: {
      decision: String,
      reason: String,
      minutesAdjustment: Number,
      adjustment: { type: mongoose.Schema.Types.ObjectId, ref: "LedgerEntry" },
      at: Date,
    },
  },
  { timestamps: true }
);

export default mongoose.model("Grievance", grievanceSchema);
