// Seeds clearly labelled SYNTHETIC demo records into a LOCAL database only.
//   node scripts/seed-local-demo.js --uri mongodb://127.0.0.1:27017/synapsis_local_dev
// Refuses any URI that is not on 127.0.0.1/localhost. Never use on shared data.
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import Coordinator from "../models/Coordinator.js";
import Event from "../models/Event.js";
import Institution from "../models/Institution.js";
import NssUnit from "../models/NssUnit.js";
import ServicePolicy from "../models/ServicePolicy.js";
import Student from "../models/Student.js";
import Teacher from "../models/Teacher.js";

const i = process.argv.indexOf("--uri");
const uri = i > 0 ? process.argv[i + 1] : "";
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(uri)) {
  console.error("Refusing: pass --uri mongodb://127.0.0.1:<port>/<db> (local databases only).");
  process.exit(1);
}
await mongoose.connect(uri);
if (await Institution.exists({ name: "SYNTHETIC DEMO COLLEGE" })) {
  console.log("Demo data already present.");
  process.exit(0);
}
const password = await bcrypt.hash("Demo-Pass-123", 10);
const base = { phoneNumber: "0000000000", department: "Demo", password, status: "active" };
const inst = await Institution.create({ name: "SYNTHETIC DEMO COLLEGE" });
const po = await Coordinator.create({ ...base, name: "Demo Programme Officer", email: "po@demo.invalid", institution: inst._id });
const teacher = await Teacher.create({ ...base, name: "Demo Supervisor", email: "teacher@demo.invalid", institution: inst._id });
const vol = await Student.create({ ...base, name: "Demo Volunteer", email: "volunteer@demo.invalid", role: "volunteer", talents: ["teaching"], institution: inst._id });
const other = await Institution.create({ name: "SYNTHETIC OTHER COLLEGE" });
await Coordinator.create({ ...base, name: "Other PO", email: "po@other.invalid", institution: other._id });
await NssUnit.create({ institution: inst._id, name: "Demo Unit", code: "DEMO-1", programmeOfficers: [po._id], supervisors: [teacher._id] });
await ServicePolicy.create({
  institution: inst._id, family: "nss-certificate", version: 1, status: "active",
  name: "SYNTHETIC demo policy (not an official preset)", requirementType: "national",
  sourceReference: "SYNTHETIC — demo only", effectiveFrom: new Date("2020-06-01"),
  rules: { academicYearStartMonth: 6, regularMinutesPerYear: 7200, yearsRequired: 2, consecutiveYears: true, camp: { required: true, requiredDays: 7 } },
  author: po._id, changeReason: "Local demo seed",
});
const day = (n) => new Date(Date.now() - n * 86400000);
await Event.create({
  title: "SYNTHETIC Literacy session", description: "Demo", date: day(3), location: "Demo village", institution: inst._id,
  hours: 3, calculatedHours: 3, status: "Completed", assignedTeacher: [teacher._id], participants: [vol._id],
  attendance: [{ student: vol._id, status: "Present", markedBy: teacher._id }],
});
const campStart = day(20);
await Event.create({
  title: "SYNTHETIC Special camp", description: "Demo", date: campStart, endDate: new Date(campStart.getTime() + 6 * 86400000), location: "Demo village",
  institution: inst._id, type: "special_camp", hours: 6, status: "Completed", assignedTeacher: [teacher._id], participants: [vol._id],
  campDays: Array.from({ length: 7 }, (_, k) => ({ date: new Date(campStart.getTime() + k * 86400000), present: [vol._id] })),
});
console.log("Seeded. Password for all demo accounts: Demo-Pass-123");
console.log("  po@demo.invalid (coordinator), teacher@demo.invalid, volunteer@demo.invalid, po@other.invalid (other institution)");
await mongoose.disconnect();
