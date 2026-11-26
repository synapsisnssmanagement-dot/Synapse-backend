import mongoose from "mongoose";

const id = mongoose.Schema.Types.ObjectId;

// Community project / activity plan. Sessions are ordinary Events created
// when the project is scheduled (Event.project + Event.sessionKey), so
// attendance, diaries and the ledger work unchanged for project sessions.
const projectSchema = new mongoose.Schema(
  {
    institution: { type: id, ref: "Institution", required: true, index: true },
    unit: { type: id, ref: "NssUnit" },
    kind: { type: String, enum: ["long_running", "recurring", "standalone"], required: true },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    description: { type: String, trim: true, maxlength: 4000, default: "" },
    category: { type: String, trim: true, maxlength: 80, default: "general" },
    community: { name: { type: String, maxlength: 200, default: "" }, adopted: { type: Boolean, default: false }, location: { type: String, maxlength: 300, default: "" } },
    needs: [{ need: String, baseline: String, source: String }],
    partner: { organisation: { type: String, maxlength: 200, default: "" }, contactRole: { type: String, maxlength: 120, default: "" } },
    goals: { type: String, maxlength: 4000, default: "" },
    plannedOutcomes: [{ metric: String, unit: String, target: Number }],
    responsibleStaff: [{ type: id, ref: "Teacher" }],
    volunteerTeams: [{ name: String, members: [{ type: id, ref: "student" }] }],
    schedule: {
      startDate: Date,
      endDate: Date,
      startTime: { type: String, default: "09:00" }, // HH:mm local
      sessionHours: { type: Number, min: 0, max: 24, default: 2 },
      recurrence: { freq: { type: String, enum: ["none", "weekly", "monthly"], default: "none" }, weekdays: [{ type: Number, min: 0, max: 6 }], count: { type: Number, min: 1, max: 200 } },
      location: { type: String, maxlength: 300, default: "" },
    },
    capacity: { type: Number, min: 1, max: 5000 },
    budgetEstimatePaise: { type: Number, min: 0, default: 0, validate: Number.isInteger },
    requiredPermissions: [{ name: String, status: { type: String, enum: ["pending", "obtained", "not_required"], default: "pending" }, reference: String, by: id, at: Date }],
    documents: [{ label: String, url: String, kind: String, addedBy: id, at: { type: Date, default: Date.now } }],
    followUps: [{ task: String, due: Date, assignee: id, status: { type: String, enum: ["open", "done"], default: "open" }, doneAt: Date }],
    communityRequest: { type: id, ref: "CommunityRequest" },
    status: { type: String, enum: ["draft", "submitted", "approved", "scheduled", "in_progress", "completed", "reviewed", "archived", "rejected", "cancelled"], default: "draft", index: true },
    rev: { type: Number, default: 0 },
    approvals: [{ step: String, by: id, decision: String, reason: String, at: { type: Date, default: Date.now } }],
    transitions: [{ from: String, to: String, by: id, reason: String, at: { type: Date, default: Date.now } }],
    review: { summary: String, by: id, at: Date },
    createdBy: id,
  },
  { timestamps: true }
);

export default mongoose.model("Project", projectSchema);
