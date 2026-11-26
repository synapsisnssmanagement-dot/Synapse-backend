import mongoose from "mongoose";

const evidenceSchema = new mongoose.Schema(
  { label: { type: String, maxlength: 200 }, url: { type: String, maxlength: 1000 } },
  { _id: false }
);

// Volunteer diary / service claim. Draft -> Submitted -> Approved | Returned | Rejected.
// Returned entries can be edited and resubmitted; every submission is kept in
// `revisions` and every decision in `decisions`. `rev` is bumped on each
// state change and used for compare-and-set transitions.
const diaryEntrySchema = new mongoose.Schema(
  {
    institution: { type: mongoose.Schema.Types.ObjectId, ref: "Institution", required: true, index: true },
    unit: { type: mongoose.Schema.Types.ObjectId, ref: "NssUnit" },
    student: { type: mongoose.Schema.Types.ObjectId, ref: "student", required: true, index: true },
    event: { type: mongoose.Schema.Types.ObjectId, ref: "Event" },
    kind: { type: String, enum: ["regular", "camp", "external"], default: "regular" },
    serviceDate: { type: Date, required: true },
    claimedMinutes: { type: Number, required: true, min: 1, max: 1440, validate: Number.isInteger },
    category: { type: String, trim: true, maxlength: 80, default: "general" },
    workDone: { type: String, trim: true, maxlength: 4000, required: true },
    reflection: { type: String, trim: true, maxlength: 4000, default: "" },
    outcomes: { type: String, trim: true, maxlength: 2000, default: "" },
    externalOrganisation: { type: String, trim: true, maxlength: 200, default: "" },
    evidence: { type: [evidenceSchema], default: [] },
    status: { type: String, enum: ["draft", "submitted", "approved", "returned", "rejected"], default: "draft", index: true },
    rev: { type: Number, default: 0 },
    attendanceCheck: { present: Boolean, note: String },
    revisions: [
      {
        at: { type: Date, default: Date.now },
        claimedMinutes: Number,
        category: String,
        workDone: String,
        reflection: String,
        outcomes: String,
      },
    ],
    decisions: [
      {
        action: { type: String, enum: ["approve", "return", "reject"] },
        by: mongoose.Schema.Types.ObjectId,
        byRole: String,
        reason: String,
        approvedMinutes: Number,
        policyVersion: Number,
        at: { type: Date, default: Date.now },
      },
    ],
    ledgerEntry: { type: mongoose.Schema.Types.ObjectId, ref: "LedgerEntry" },
  },
  { timestamps: true }
);

export default mongoose.model("DiaryEntry", diaryEntrySchema);
