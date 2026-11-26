import mongoose from "mongoose";

// Explicit record of evaluating a volunteer's history under a policy version
// other than the one their credits were approved under. Credits are never
// changed by this; it documents the comparison and the decision.
const recalculationSchema = new mongoose.Schema(
  {
    institution: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    student: { type: mongoose.Schema.Types.ObjectId, ref: "student", required: true },
    toPolicy: { type: mongoose.Schema.Types.ObjectId, ref: "ServicePolicy", required: true },
    toPolicyVersion: Number,
    originalPolicyVersions: [Number],
    before: mongoose.Schema.Types.Mixed, // evaluations under the originally recorded versions
    after: mongoose.Schema.Types.Mixed, // evaluation under toPolicy
    reason: { type: String, required: true },
    by: { type: mongoose.Schema.Types.ObjectId, required: true },
  },
  { timestamps: true }
);

export default mongoose.model("Recalculation", recalculationSchema);
