import mongoose from "mongoose";

// Versioned service policy. A version is immutable once activated: changing
// a rule means creating the next version with a reason. Records approved
// under a version keep a reference to it.
//
// requirementType keeps three things apart:
//   national        - national NSS certificate requirements (as the institution has verified them)
//   local_academic  - institution-specific academic completion
//   benefit         - grace mark / other benefit eligibility
const servicePolicySchema = new mongoose.Schema(
  {
    institution: { type: mongoose.Schema.Types.ObjectId, ref: "Institution", required: true, index: true },
    family: { type: String, required: true, trim: true, maxlength: 60 }, // groups versions
    version: { type: Number, required: true, min: 1 },
    name: { type: String, required: true, trim: true, maxlength: 160 },
    purpose: { type: String, trim: true, maxlength: 1000, default: "" },
    requirementType: { type: String, enum: ["national", "local_academic", "benefit"], required: true },
    sourceReference: { type: String, trim: true, maxlength: 500, default: "" },
    verifiedByInstitution: { type: Boolean, default: false },
    effectiveFrom: { type: Date, required: true },
    effectiveTo: { type: Date },
    appliesTo: {
      unit: { type: mongoose.Schema.Types.ObjectId, ref: "NssUnit" },
      programme: { type: String, default: "" },
      batch: { type: String, default: "" },
    },
    status: { type: String, enum: ["draft", "active", "retired"], default: "draft" },
    rules: {
      academicYearStartMonth: { type: Number, min: 1, max: 12, default: 6 }, // 1-based
      regularMinutesPerYear: { type: Number, min: 0, default: 0 },
      yearsRequired: { type: Number, min: 0, max: 6, default: 0 },
      consecutiveYears: { type: Boolean, default: false },
      categories: [{ name: { type: String, required: true }, minMinutes: { type: Number, min: 0, default: 0 } }],
      camp: {
        required: { type: Boolean, default: false },
        requiredDays: { type: Number, min: 0, default: 0 },
      },
      maxClaimMinutesPerDay: { type: Number, min: 0, default: 720 },
      complaintWindowDays: { type: Number, min: 1, max: 365, default: 30 },
      evidenceRequired: { type: Boolean, default: false },
      countLegacy: { type: Boolean, default: false },
      reportSignatories: [{ type: String }],
    },
    author: { type: mongoose.Schema.Types.ObjectId, required: true },
    changeReason: { type: String, trim: true, maxlength: 1000, required: true },
    history: [
      {
        action: String,
        by: mongoose.Schema.Types.ObjectId,
        at: { type: Date, default: Date.now },
        reason: String,
      },
    ],
  },
  { timestamps: true }
);
servicePolicySchema.index({ institution: 1, family: 1, version: 1 }, { unique: true });

export default mongoose.model("ServicePolicy", servicePolicySchema);
