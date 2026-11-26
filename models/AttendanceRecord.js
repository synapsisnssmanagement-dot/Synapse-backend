import mongoose from "mongoose";

// Session-level attendance (one per volunteer per activity per day).
// GPS is stored as supporting evidence only; verification is a separate,
// human step. Offline submissions carry a client operation id; a conflicting
// offline version never overwrites the server copy - both are kept.
const snapshot = {
  status: String,
  checkInAt: Date,
  checkOutAt: Date,
  minutes: Number,
};
const attendanceRecordSchema = new mongoose.Schema(
  {
    institution: { type: mongoose.Schema.Types.ObjectId, ref: "Institution", required: true, index: true },
    event: { type: mongoose.Schema.Types.ObjectId, ref: "Event", required: true, index: true },
    student: { type: mongoose.Schema.Types.ObjectId, ref: "student", required: true, index: true },
    sessionDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    status: { type: String, enum: ["present", "partial", "absent", "excused"], required: true },
    checkInAt: Date,
    checkOutAt: Date,
    minutes: { type: Number, min: 0, max: 1440, validate: Number.isInteger },
    method: { type: String, enum: ["self_gps", "self_no_location", "supervisor", "offline_supervisor", "manual_correction"], required: true },
    geo: { lat: Number, lng: Number, accuracy: Number, distance: Number, withinRadius: Boolean, note: String },
    verification: { type: String, enum: ["unverified", "verified", "disputed"], default: "unverified" },
    verifiedBy: mongoose.Schema.Types.ObjectId,
    verifiedAt: Date,
    recordedBy: mongoose.Schema.Types.ObjectId,
    rev: { type: Number, default: 0 },
    corrections: [{ by: mongoose.Schema.Types.ObjectId, reason: String, before: snapshot, after: snapshot, at: { type: Date, default: Date.now } }],
    conflicts: [{ opId: String, by: mongoose.Schema.Types.ObjectId, incoming: snapshot, capturedAt: Date, receivedAt: { type: Date, default: Date.now }, resolved: { type: Boolean, default: false }, resolution: String }],
    appliedOps: [String],
  },
  { timestamps: true }
);
attendanceRecordSchema.index({ event: 1, student: 1, sessionDate: 1 }, { unique: true });
attendanceRecordSchema.index({ appliedOps: 1 });

export default mongoose.model("AttendanceRecord", attendanceRecordSchema);
