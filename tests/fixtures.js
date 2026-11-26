// Synthetic fixtures shared by test files. Everything is labelled SYNTHETIC.
import Coordinator from "../models/Coordinator.js";
import Institution from "../models/Institution.js";
import ServicePolicy from "../models/ServicePolicy.js";
import Student from "../models/Student.js";
import Teacher from "../models/Teacher.js";
import { tokenFor } from "./harness.js";

export const TAG = "SYNTHETIC TEST";
const rnd = () => Math.random().toString(36).slice(2, 9);
export const person = (Model, inst, extra = {}) =>
  Model.create({ name: `${TAG} ${Model.modelName} ${rnd()}`, email: `${rnd()}${rnd()}@example.test`, phoneNumber: "0000000000", department: "Test", password: "x", institution: inst._id, status: "active", ...extra });

export async function baseFixtures() {
  const F = {};
  F.instA = await Institution.create({ name: `${TAG} College A ${rnd()}` });
  F.instB = await Institution.create({ name: `${TAG} College B ${rnd()}` });
  F.po = await person(Coordinator, F.instA);
  F.po2 = await person(Coordinator, F.instA);
  F.poB = await person(Coordinator, F.instB);
  F.teacher = await person(Teacher, F.instA);
  F.otherTeacher = await person(Teacher, F.instA);
  F.vol = await person(Student, F.instA, { role: "volunteer", talents: ["x"] });
  F.vol2 = await person(Student, F.instA, { role: "volunteer", talents: ["x"] });
  F.volB = await person(Student, F.instB, { role: "volunteer", talents: ["x"] });
  F.t = {};
  for (const [k, role] of [["po", "coordinator"], ["po2", "coordinator"], ["poB", "coordinator"], ["teacher", "teacher"], ["otherTeacher", "teacher"], ["vol", "volunteer"], ["vol2", "volunteer"], ["volB", "volunteer"]]) F.t[k] = tokenFor(F[k], role);
  return F;
}

export const activePolicy = (inst, author, rules = {}) =>
  ServicePolicy.create({
    institution: inst._id, family: "nss-certificate", version: 1, status: "active", name: `${TAG} policy`, requirementType: "national",
    sourceReference: "SYNTHETIC", effectiveFrom: new Date("2015-06-01"), author: author._id, changeReason: "test",
    rules: { academicYearStartMonth: 6, regularMinutesPerYear: 7200, yearsRequired: 2, consecutiveYears: true, camp: { required: true, requiredDays: 7 }, reportSignatories: ["Programme Officer", "Principal"], ...rules },
  });
