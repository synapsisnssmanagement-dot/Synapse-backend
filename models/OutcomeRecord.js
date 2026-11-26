import mongoose from "mongoose";

const id = mongoose.Schema.Types.ObjectId;

// Project outcomes, kept separate from attendance. Levels:
//   reported  - observed and reported (by a volunteer or staff member)
//   followup  - a later observation of an earlier verified outcome (e.g. tree survival)
// Planned targets live on Project.plannedOutcomes. A record counts as
// "verified" only after review by someone other than its reporter. Only
// verified records an officer publishes appear on public pages.
// No beneficiary-identifying fields exist here by design.
const outcomeRecordSchema = new mongoose.Schema(
  {
    institution: { type: id, required: true, index: true },
    project: { type: id, ref: "Project", required: true, index: true },
    event: { type: id, ref: "Event" },
    metric: { type: String, required: true, trim: true, maxlength: 120 },
    unit: { type: String, trim: true, maxlength: 40, default: "" },
    value: { type: Number, required: true, min: 0 },
    level: { type: String, enum: ["reported", "followup"], required: true },
    followUpOf: { type: id, ref: "OutcomeRecord" },
    observedAt: { type: Date, required: true },
    note: { type: String, maxlength: 1000, default: "" },
    evidence: [{ label: String, url: String }],
    reportedBy: { type: id, required: true },
    reporterRole: String,
    verification: { status: { type: String, enum: ["pending", "verified", "rejected"], default: "pending" }, by: id, at: Date, reason: String },
    partnerConfirmation: { confirmed: { type: Boolean, default: false }, partnerRole: String, note: String, recordedBy: id, at: Date },
    publication: { approved: { type: Boolean, default: false }, by: id, at: Date },
    rev: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export default mongoose.model("OutcomeRecord", outcomeRecordSchema);
