import mongoose from "mongoose";

// Period reconciliation: computed register totals vs the balance on the
// bank/cash statement, with the difference explained. Snapshot is frozen.
const reconciliationSchema = new mongoose.Schema(
  {
    institution: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    from: { type: Date, required: true },
    to: { type: Date, required: true },
    snapshot: { type: mongoose.Schema.Types.Mixed, required: true },
    statementBalancePaise: { type: Number, required: true, validate: Number.isInteger },
    differencePaise: { type: Number, required: true },
    explanation: { type: String, maxlength: 2000, default: "" },
    status: { type: String, enum: ["draft", "approved"], default: "draft" },
    preparedBy: mongoose.Schema.Types.ObjectId,
    approvedBy: mongoose.Schema.Types.ObjectId,
    approvedAt: Date,
  },
  { timestamps: true }
);

export default mongoose.model("Reconciliation", reconciliationSchema);
