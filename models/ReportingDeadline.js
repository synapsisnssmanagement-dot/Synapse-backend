import mongoose from "mongoose";

// Reporting deadlines the institution must meet (e.g. university's monthly
// report). Met when an approved report of that type exists for the period.
const reportingDeadlineSchema = new mongoose.Schema(
  {
    institution: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    title: { type: String, required: true, maxlength: 200 },
    reportType: { type: String, default: "" },
    periodFrom: Date,
    periodTo: Date,
    dueDate: { type: Date, required: true },
    recipient: { type: String, maxlength: 200, default: "" },
    status: { type: String, enum: ["open", "done"], default: "open" },
    doneAt: Date,
    createdBy: mongoose.Schema.Types.ObjectId,
  },
  { timestamps: true }
);

export default mongoose.model("ReportingDeadline", reportingDeadlineSchema);
