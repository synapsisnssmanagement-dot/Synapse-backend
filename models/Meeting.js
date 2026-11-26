import mongoose from "mongoose";

// Advisory committee meetings and minutes. Approved minutes are locked.
const meetingSchema = new mongoose.Schema(
  {
    institution: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    kind: { type: String, enum: ["advisory_committee", "unit_meeting", "other"], default: "advisory_committee" },
    date: { type: Date, required: true },
    attendees: [{ name: String, role: String }],
    agenda: { type: String, maxlength: 4000, default: "" },
    minutes: { type: String, maxlength: 20000, default: "" },
    decisions: [{ text: String }],
    actionItems: [{ task: String, owner: String, due: Date, status: { type: String, enum: ["open", "done"], default: "open" } }],
    status: { type: String, enum: ["draft", "approved"], default: "draft" },
    recordedBy: mongoose.Schema.Types.ObjectId,
    approvedBy: mongoose.Schema.Types.ObjectId,
    approvedAt: Date,
  },
  { timestamps: true }
);

export default mongoose.model("Meeting", meetingSchema);
