import mongoose from "mongoose";

// An NSS unit inside an institution. An institution can run several units;
// each has a code, Programme Officers (coordinator accounts) and supervisors
// (teacher accounts) who may review that unit's service.
const nssUnitSchema = new mongoose.Schema(
  {
    institution: { type: mongoose.Schema.Types.ObjectId, ref: "Institution", required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    code: { type: String, required: true, trim: true, uppercase: true, maxlength: 40 },
    level: { type: String, enum: ["college", "higher_secondary"], default: "college" },
    governingBody: { type: String, trim: true, maxlength: 200, default: "" },
    programmeOfficers: [{ type: mongoose.Schema.Types.ObjectId, ref: "Coordinator" }],
    supervisors: [{ type: mongoose.Schema.Types.ObjectId, ref: "Teacher" }],
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);
nssUnitSchema.index({ institution: 1, code: 1 }, { unique: true });

export default mongoose.model("NssUnit", nssUnitSchema);
