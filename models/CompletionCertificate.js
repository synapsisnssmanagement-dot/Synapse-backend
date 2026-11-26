import mongoose from "mongoose";

// NSS / institutional completion certificate, distinct from event
// participation certificates. It carries a frozen snapshot of the ledger
// evaluation it was issued on. Nothing is deleted: revocation and reissue
// add history, and a reissue points back to the record it supersedes.
const completionCertificateSchema = new mongoose.Schema(
  {
    certId: { type: String, required: true, unique: true },
    institution: { type: mongoose.Schema.Types.ObjectId, ref: "Institution", required: true, index: true },
    unit: { type: mongoose.Schema.Types.ObjectId, ref: "NssUnit" },
    student: { type: mongoose.Schema.Types.ObjectId, ref: "student", required: true, index: true },
    studentName: String,
    policy: { type: mongoose.Schema.Types.ObjectId, ref: "ServicePolicy", required: true },
    policyVersion: { type: Number, required: true },
    policyName: String,
    requirementType: { type: String, enum: ["national", "local_academic", "benefit"], required: true },
    snapshot: { type: mongoose.Schema.Types.Mixed, required: true }, // summary + evaluation at preparation
    exception: { granted: Boolean, reason: String, basis: String },
    status: { type: String, enum: ["pending_review", "issued", "rejected", "revoked", "superseded"], default: "pending_review", index: true },
    rev: { type: Number, default: 0 },
    preparedBy: mongoose.Schema.Types.ObjectId,
    reviewedBy: mongoose.Schema.Types.ObjectId,
    issuedAt: Date,
    supersedes: { type: mongoose.Schema.Types.ObjectId, ref: "CompletionCertificate" },
    supersededBy: { type: mongoose.Schema.Types.ObjectId, ref: "CompletionCertificate" },
    signatories: [{ role: String, name: String }],
    history: [{ action: String, by: mongoose.Schema.Types.ObjectId, reason: String, at: { type: Date, default: Date.now } }],
  },
  { timestamps: true }
);
// At most one live (pending or issued) certificate per student and policy family version.
completionCertificateSchema.index(
  { student: 1, policy: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ["pending_review", "issued"] } } }
);

export default mongoose.model("CompletionCertificate", completionCertificateSchema);
