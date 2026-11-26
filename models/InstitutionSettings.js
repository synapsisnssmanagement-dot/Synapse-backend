import mongoose from "mongoose";

// Per-institution operational settings: approval chains and school/privacy
// defaults. One document per institution; absent means platform defaults.
const step = new mongoose.Schema(
  {
    name: { type: String, required: true, maxlength: 120 }, // e.g. "Programme Officer", "Principal"
    // Specific approvers (coordinator or teacher ids). Empty = any active Programme Officer.
    approvers: [{ type: mongoose.Schema.Types.ObjectId }],
  },
  { _id: false }
);
const institutionSettingsSchema = new mongoose.Schema(
  {
    institution: { type: mongoose.Schema.Types.ObjectId, ref: "Institution", required: true, unique: true },
    kind: { type: String, enum: ["college", "higher_secondary_school", "school_with_lower_classes"], default: "college" },
    approvalChains: {
      project: { type: [step], default: undefined },
      camp: { type: [step], default: undefined },
    },
    privacy: {
      publicProfilesDefault: { type: String, enum: ["visible", "hidden"], default: "visible" },
      minorsPublicProfile: { type: String, enum: ["hidden", "first_name_only"], default: "hidden" },
    },
    updatedBy: mongoose.Schema.Types.ObjectId,
    history: [{ by: mongoose.Schema.Types.ObjectId, change: String, at: { type: Date, default: Date.now } }],
  },
  { timestamps: true }
);

export default mongoose.model("InstitutionSettings", institutionSettingsSchema);
