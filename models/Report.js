import mongoose from "mongoose";

const id = mongoose.Schema.Types.ObjectId;

// Versioned report template (title, columns shown, signatories). Built-in
// defaults are used when an institution has none; they are labelled drafts.
const reportTemplateSchema = new mongoose.Schema(
  {
    institution: { type: id, required: true, index: true },
    type: { type: String, required: true },
    version: { type: Number, required: true, min: 1 },
    title: { type: String, required: true, maxlength: 200 },
    columns: [{ key: String, label: String }],
    signatories: [{ type: String, maxlength: 120 }],
    footerNote: { type: String, maxlength: 1000, default: "" },
    status: { type: String, enum: ["draft", "active", "retired"], default: "draft" },
    changeReason: { type: String, required: true, maxlength: 1000 },
    author: id,
  },
  { timestamps: true }
);
reportTemplateSchema.index({ institution: 1, type: 1, version: 1 }, { unique: true });
export const ReportTemplate = mongoose.model("ReportTemplate", reportTemplateSchema);

// A generated report: frozen snapshot of the data at generation, draft until approved.
const generatedReportSchema = new mongoose.Schema(
  {
    institution: { type: id, required: true, index: true },
    unit: { type: id, ref: "NssUnit" },
    type: { type: String, required: true, index: true },
    template: { type: id, ref: "ReportTemplate" },
    templateVersion: { type: Number }, // 0 = built-in default
    title: String,
    period: { from: Date, to: Date, label: String },
    policy: { _id: id, name: String, version: Number },
    data: { type: mongoose.Schema.Types.Mixed, required: true }, // { columns, rows, totals, notes }
    checksum: { type: String, required: true },
    signatories: [String],
    status: { type: String, enum: ["draft", "approved", "superseded"], default: "draft" },
    generatedBy: { type: id, required: true },
    generatedAt: { type: Date, default: Date.now },
    approvedBy: id,
    approvedAt: Date,
  },
  { timestamps: true }
);
export const GeneratedReport = mongoose.model("GeneratedReport", generatedReportSchema);
