import mongoose from "mongoose";

// Planned budget per academic year and head (integer paise). Versioned by
// replacement with history; distinct from expenses and cash movements.
const budgetSchema = new mongoose.Schema(
  {
    institution: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    academicYear: { type: Number, required: true },
    head: { type: String, required: true, trim: true, maxlength: 80 },
    amountPaise: { type: Number, required: true, min: 0, validate: Number.isInteger },
    note: { type: String, maxlength: 500, default: "" },
    history: [{ amountPaise: Number, by: mongoose.Schema.Types.ObjectId, reason: String, at: { type: Date, default: Date.now } }],
  },
  { timestamps: true }
);
budgetSchema.index({ institution: 1, academicYear: 1, head: 1 }, { unique: true });

export default mongoose.model("Budget", budgetSchema);
