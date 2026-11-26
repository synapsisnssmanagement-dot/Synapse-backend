import mongoose from "mongoose";

// Canonical service ledger. Entries are append-only: a correction is a new
// "adjustment" or "reversal" entry that references the entry it corrects.
// idempotencyKey is unique, so the same credit can never be written twice,
// whichever path (diary approval, attendance, grievance) tries to write it.
const ledgerEntrySchema = new mongoose.Schema(
  {
    institution: { type: mongoose.Schema.Types.ObjectId, ref: "Institution", required: true, index: true },
    unit: { type: mongoose.Schema.Types.ObjectId, ref: "NssUnit" },
    student: { type: mongoose.Schema.Types.ObjectId, ref: "student", required: true, index: true },
    enrolment: { type: mongoose.Schema.Types.ObjectId, ref: "Enrolment" },
    event: { type: mongoose.Schema.Types.ObjectId, ref: "Event" },
    diary: { type: mongoose.Schema.Types.ObjectId, ref: "DiaryEntry" },
    grievance: { type: mongoose.Schema.Types.ObjectId, ref: "Grievance" },
    serviceDate: { type: Date, required: true },
    academicYear: { type: Number, required: true },
    kind: { type: String, enum: ["regular", "camp"], required: true },
    // Lower-school community service is recorded but never counts as NSS service.
    programme: { type: String, enum: ["nss", "community_service"], default: "nss" },
    category: { type: String, trim: true, default: "general" },
    entryType: { type: String, enum: ["credit", "adjustment", "reversal", "legacy"], required: true },
    claimedMinutes: { type: Number, default: 0 },
    minutes: { type: Number, required: true, validate: Number.isInteger }, // signed
    adjusts: { type: mongoose.Schema.Types.ObjectId, ref: "LedgerEntry" },
    policy: { type: mongoose.Schema.Types.ObjectId, ref: "ServicePolicy" },
    policyVersion: { type: Number },
    approver: { type: mongoose.Schema.Types.ObjectId },
    approverRole: { type: String },
    approvedAt: { type: Date, default: Date.now },
    reason: { type: String, maxlength: 1000, default: "" },
    evidence: [{ label: String, url: String }],
    importBatch: { type: String, index: true }, // set only by the legacy import script
    idempotencyKey: { type: String, required: true, unique: true },
  },
  { timestamps: true }
);
ledgerEntrySchema.index({ student: 1, academicYear: 1 });

export default mongoose.model("LedgerEntry", ledgerEntrySchema);
