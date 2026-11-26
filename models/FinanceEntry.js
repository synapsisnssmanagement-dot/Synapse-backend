import mongoose from "mongoose";

const id = mongoose.Schema.Types.ObjectId;
const paise = { type: Number, required: true, min: 1, validate: Number.isInteger };

// Operational finance register (integer paise). Append-only: a recorded entry
// is corrected by a "reversal" entry, never edited. Kinds are kept distinct:
//   grant             money received from a funding body (sanction reference)
//   advance           cash advanced to a staff member
//   advance_return    unspent advance returned
//   expense           money spent (optionally against an advance), with voucher/receipt refs
//   reversal          cancels another entry (reason required)
// Online donations stay in the existing Donation collection and are read-only here.
const financeEntrySchema = new mongoose.Schema(
  {
    institution: { type: id, required: true, index: true },
    unit: { type: id, ref: "NssUnit" },
    kind: { type: String, enum: ["grant", "advance", "advance_return", "expense", "reversal"], required: true, index: true },
    amountPaise: paise,
    date: { type: Date, required: true },
    academicYear: { type: Number, required: true },
    head: { type: String, trim: true, maxlength: 80, default: "general" }, // budget head
    description: { type: String, trim: true, maxlength: 1000, required: true },
    mode: { type: String, enum: ["bank", "cash", "upi", "cheque", "other"], default: "bank" },
    source: { type: String, trim: true, maxlength: 200, default: "" }, // grantor / payee
    reference: { type: String, trim: true, maxlength: 200, default: "" }, // sanction no., voucher no., receipt no.
    receipts: [{ label: String, url: String }],
    holder: { type: id }, // staff member holding an advance
    advance: { type: id, ref: "FinanceEntry" }, // expense/return settled against an advance
    camp: { type: id, ref: "CampPlan" },
    project: { type: id, ref: "Project" },
    reverses: { type: id, ref: "FinanceEntry" },
    status: { type: String, enum: ["recorded", "verified"], default: "recorded" },
    recordedBy: { type: id, required: true },
    verifiedBy: id,
    verifiedAt: Date,
    opId: { type: String, required: true, unique: true }, // client operation id: no duplicate entries on retry
  },
  { timestamps: true }
);
financeEntrySchema.index({ reverses: 1 }, { unique: true, partialFilterExpression: { reverses: { $exists: true } } });

export default mongoose.model("FinanceEntry", financeEntrySchema);
