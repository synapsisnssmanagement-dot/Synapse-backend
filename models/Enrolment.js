import mongoose from "mongoose";

// A volunteer's enrolment in one NSS unit for one academic year.
const enrolmentSchema = new mongoose.Schema(
  {
    institution: { type: mongoose.Schema.Types.ObjectId, ref: "Institution", required: true, index: true },
    unit: { type: mongoose.Schema.Types.ObjectId, ref: "NssUnit", required: true, index: true },
    student: { type: mongoose.Schema.Types.ObjectId, ref: "student", required: true, index: true },
    academicYear: { type: Number, required: true, min: 2000, max: 2100 }, // start year
    programme: { type: String, trim: true, maxlength: 120, default: "" },
    batch: { type: String, trim: true, maxlength: 60, default: "" },
    // XI/XII are higher-secondary NSS; "community_service" marks a non-NSS
    // lower-school programme so it never counts towards NSS requirements.
    level: { type: String, enum: ["UG", "PG", "XI", "XII", "community_service"], default: "UG" },
    status: { type: String, enum: ["enrolled", "active", "completed", "withdrawn"], default: "enrolled" },
    serviceStart: { type: Date },
    serviceEnd: { type: Date },
    guardianPermission: {
      required: { type: Boolean, default: false },
      received: { type: Boolean, default: false },
      recordedBy: { type: mongoose.Schema.Types.ObjectId },
      recordedAt: { type: Date },
    },
    enrolledBy: { type: mongoose.Schema.Types.ObjectId },
  },
  { timestamps: true }
);
enrolmentSchema.index({ student: 1, unit: 1, academicYear: 1 }, { unique: true });

export default mongoose.model("Enrolment", enrolmentSchema);
