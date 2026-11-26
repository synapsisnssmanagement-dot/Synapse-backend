import mongoose from "mongoose";

const id = mongoose.Schema.Types.ObjectId;

// Special camp planning and operations. The camp Event (type special_camp) is
// created only when the proposal is approved, so existing roll-call/diary
// screens keep working against approved camps only.
//
// Emergency contacts are stored here but never returned by the general camp
// endpoints; only the restricted contacts endpoint serves them.
const campPlanSchema = new mongoose.Schema(
  {
    institution: { type: id, ref: "Institution", required: true, index: true },
    unit: { type: id, ref: "NssUnit" },
    event: { type: id, ref: "Event" },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    capacity: { type: Number, min: 1, max: 1000, required: true },
    hoursPerDay: { type: Number, min: 0, max: 24, default: 6 },
    site: {
      community: { type: String, maxlength: 200, default: "" },
      address: { type: String, maxlength: 500, default: "" },
      hostOrganisation: { type: String, maxlength: 200, default: "" },
      hostContactRole: { type: String, maxlength: 120, default: "" },
      needs: { type: String, maxlength: 2000, default: "" },
    },
    objectives: { type: String, maxlength: 4000, default: "" },
    guardianPermissionRequired: { type: Boolean, default: false },
    requiredDocuments: [{ type: String, enum: ["guardian_consent", "fitness_declaration", "institution_permission", "id_proof"] }],
    supervisors: [{ type: id, ref: "Teacher" }],
    status: { type: String, enum: ["draft", "submitted", "approved", "in_progress", "completed", "reviewed", "rejected", "cancelled"], default: "draft", index: true },
    rev: { type: Number, default: 0 },
    transitions: [{ from: String, to: String, by: id, reason: String, at: { type: Date, default: Date.now } }],
    approvals: [{ step: String, by: id, decision: String, reason: String, at: { type: Date, default: Date.now } }],
    programme: [{ date: String, items: [{ time: String, activity: String, lead: String }] }],
    applications: [
      {
        student: { type: id, ref: "student", required: true },
        status: { type: String, enum: ["applied", "selected", "confirmed", "waitlisted", "withdrawn", "declined"], default: "applied" },
        appliedAt: { type: Date, default: Date.now },
        decidedBy: id,
        note: String,
      },
    ],
    // Status of documents only; no medical or guardian files are stored here.
    documents: [{ student: { type: id, ref: "student" }, type: { type: String }, status: { type: String, enum: ["pending", "received", "verified", "rejected"] }, note: String, by: id, at: { type: Date, default: Date.now } }],
    emergencyContacts: [{ student: { type: id, ref: "student" }, name: String, relation: String, phone: String, updatedBy: id, at: Date }],
    teams: [{ name: String, supervisor: { type: id, ref: "Teacher" }, members: [{ type: id, ref: "student" }], duties: String }],
    meals: [{ date: String, meal: String, headcount: Number, notes: String }],
    transport: [{ date: String, mode: String, from: String, to: String, notes: String }],
    materials: [{ item: String, quantity: Number, unit: String, status: { type: String, enum: ["needed", "arranged", "received", "returned"], default: "needed" } }],
    budget: [{ head: String, estimatePaise: { type: Number, min: 0, validate: Number.isInteger } }],
    closingReport: { summary: String, outcomes: String, issues: String, submittedBy: id, submittedAt: Date, reviewedBy: id, reviewedAt: Date, reviewNotes: String },
    completionDecisions: [{ student: { type: id, ref: "student" }, decision: { type: String, enum: ["complete", "incomplete", "exception"] }, daysCredited: Number, missingDays: [String], reason: String, basis: String, by: id, at: { type: Date, default: Date.now } }],
  },
  { timestamps: true }
);

export default mongoose.model("CampPlan", campPlanSchema);
