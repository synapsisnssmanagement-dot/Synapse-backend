// NSS operations: units, enrolments, versioned policies, the service ledger,
// volunteer diaries, hours grievances and the Programme Officer workspace.
//
// Authorisation is enforced here per record, never only by hidden UI:
//  - every record is scoped to req.user.institution;
//  - Programme Officers are active coordinator accounts;
//  - a teacher may review only events they are assigned to;
//  - volunteers see and edit only their own records.
import mongoose from "mongoose";
import AttendanceRecord from "../models/AttendanceRecord.js";
import DiaryEntry from "../models/DiaryEntry.js";
import { GeneratedReport } from "../models/Report.js";
import ReportingDeadline from "../models/ReportingDeadline.js";
import Reconciliation from "../models/Reconciliation.js";
import Project from "../models/Project.js";
import FinanceEntry from "../models/FinanceEntry.js";
import CampPlan from "../models/CampPlan.js";
import Enrolment from "../models/Enrolment.js";
import Event from "../models/Event.js";
import Grievance from "../models/Grievance.js";
import LedgerEntry from "../models/LedgerEntry.js";
import NssUnit from "../models/NssUnit.js";
import ServicePolicy from "../models/ServicePolicy.js";
import Student from "../models/Student.js";
import {
  academicYearFor,
  canTransition,
  creditKey,
  dayKey,
  evaluatePolicy,
  missingCampDays,
  summariseLedger,
  toMinutes,
  yearLabel,
} from "../utils/serviceRules.js";

import {
  T,
  HttpError,
  bad,
  forbid,
  notFound,
  conflict,
  handle,
  oid,
  pick,
  str,
  int,
  date,
  reasonRequired,
  evidenceList,
  inst,
  roleOf,
  isActive,
  requireActive,
  requireOfficer,
  requireVolunteer,
  sameInst,
  loadOwn,
  audit,
} from "../utils/opsHelpers.js";

// May this caller review service for this event? Officers: any event of
// their institution. Teachers: only events they are assigned to supervise.
const canReview = (req, event) => {
  if (!isActive(req)) return false;
  if (req.coordinator) return !event || sameInst(req, event);
  if (req.teacher) return Boolean(event) && sameInst(req, event) && (event.assignedTeacher || []).some((t) => String(t) === String(req.user._id));
  return false;
};

// Policy in effect on a date (most recent active version of the family).
const policyFor = (institution, at, family = "nss-certificate") =>
  ServicePolicy.findOne({
    institution,
    family,
    status: "active",
    effectiveFrom: T({ $lte: at }),
    $or: [{ effectiveTo: null }, { effectiveTo: T({ $exists: false }) }, { effectiveTo: T({ $gt: at }) }],
  })
    .sort({ version: -1 })
    .lean();

// ───────── units ─────────
export const listUnits = handle(async (req, res) => {
  requireActive(req);
  const units = await NssUnit.find({ institution: inst(req) }).sort({ code: 1 }).lean();
  res.json({ success: true, units });
});
export const createUnit = handle(async (req, res) => {
  requireOfficer(req);
  const b = req.body || {};
  const unit = await NssUnit.create({
    institution: inst(req),
    name: str(b.name, 120),
    code: str(b.code, 40),
    level: b.level === "higher_secondary" ? "higher_secondary" : "college",
    governingBody: str(b.governingBody, 200),
    programmeOfficers: [req.user._id],
  });
  audit(req, "unit.create", "NssUnit", unit._id, { code: unit.code });
  res.status(201).json({ success: true, unit });
});
export const updateUnit = handle(async (req, res) => {
  requireOfficer(req);
  const unit = await loadOwn(NssUnit, req.params.id, req, "unit");
  const b = pick(req.body, ["name", "governingBody", "active", "supervisors", "programmeOfficers"]);
  if (b.name !== undefined) unit.name = str(b.name, 120);
  if (b.governingBody !== undefined) unit.governingBody = str(b.governingBody, 200);
  if (b.active !== undefined) unit.active = Boolean(b.active);
  if (b.supervisors) unit.supervisors = b.supervisors.map((x) => oid(x, "supervisor"));
  if (b.programmeOfficers) unit.programmeOfficers = b.programmeOfficers.map((x) => oid(x, "officer"));
  await unit.save();
  audit(req, "unit.update", "NssUnit", unit._id, Object.keys(b));
  res.json({ success: true, unit });
});

// ───────── enrolments ─────────
export const listEnrolments = handle(async (req, res) => {
  requireOfficer(req);
  const q = { institution: inst(req) };
  if (req.query.unit) q.unit = oid(req.query.unit, "unit");
  if (req.query.academicYear) q.academicYear = int(req.query.academicYear, "academicYear", { min: 2000, max: 2100 });
  if (req.query.status) q.status = str(req.query.status, 20);
  if (req.query.batch) q.batch = str(req.query.batch, 60);
  const enrolments = await Enrolment.find(q).populate("student", "name email department").populate("unit", "code name").sort({ createdAt: -1 }).limit(500).lean();
  res.json({ success: true, enrolments });
});
export const createEnrolment = handle(async (req, res) => {
  requireOfficer(req);
  const b = req.body || {};
  const unit = await loadOwn(NssUnit, b.unit, req, "unit");
  const student = await loadOwn(Student, b.student, req, "volunteer");
  const level = ["UG", "PG", "XI", "XII", "community_service"].includes(b.level) ? b.level : "UG";
  if (unit.level === "higher_secondary" && !["XI", "XII", "community_service"].includes(level)) throw bad("Higher-secondary units enrol Class XI/XII students");
  const enrolment = await Enrolment.create({
    institution: inst(req),
    unit: unit._id,
    student: student._id,
    academicYear: int(b.academicYear, "academicYear", { min: 2000, max: 2100 }),
    programme: str(b.programme, 120),
    batch: str(b.batch, 60),
    level,
    status: "enrolled",
    serviceStart: b.serviceStart ? date(b.serviceStart, "serviceStart") : undefined,
    guardianPermission: { required: ["XI", "XII", "community_service"].includes(level), received: false },
    enrolledBy: req.user._id,
  });
  audit(req, "enrolment.create", "Enrolment", enrolment._id, { student: student._id });
  res.status(201).json({ success: true, enrolment });
});
export const updateEnrolment = handle(async (req, res) => {
  requireOfficer(req);
  const e = await loadOwn(Enrolment, req.params.id, req, "enrolment");
  const b = req.body || {};
  if (b.status !== undefined) {
    if (!["enrolled", "active", "completed", "withdrawn"].includes(b.status)) throw bad("Invalid status");
    e.status = b.status;
  }
  if (b.serviceEnd !== undefined) e.serviceEnd = date(b.serviceEnd, "serviceEnd");
  if (b.batch !== undefined) e.batch = str(b.batch, 60);
  if (b.guardianPermissionReceived !== undefined) {
    e.guardianPermission.received = Boolean(b.guardianPermissionReceived);
    e.guardianPermission.recordedBy = req.user._id;
    e.guardianPermission.recordedAt = new Date();
  }
  await e.save();
  audit(req, "enrolment.update", "Enrolment", e._id, pick(b, ["status", "serviceEnd", "batch", "guardianPermissionReceived"]));
  res.json({ success: true, enrolment: e });
});

// ───────── policies ─────────
// Starting point for a new policy. Explicitly a draft: the values must be
// checked against the institution's current NSS documents before activation.
export const policyTemplate = handle(async (req, res) => {
  requireActive(req);
  res.json({
    success: true,
    template: {
      family: "nss-certificate",
      name: "NSS certificate requirements (DRAFT — requires institutional review)",
      requirementType: "national",
      purpose: "Unverified starting template. Confirm every value against the current NSS Manual and your university's notification before activating.",
      sourceReference: "",
      rules: {
        academicYearStartMonth: 6,
        regularMinutesPerYear: 120 * 60,
        yearsRequired: 2,
        consecutiveYears: true,
        categories: [],
        camp: { required: true, requiredDays: 7 },
        maxClaimMinutesPerDay: 720,
        complaintWindowDays: 30,
        evidenceRequired: false,
        countLegacy: false,
      },
    },
  });
});
export const listPolicies = handle(async (req, res) => {
  requireActive(req);
  const policies = await ServicePolicy.find({ institution: inst(req) }).sort({ family: 1, version: -1 }).lean();
  res.json({ success: true, policies });
});
const cleanRules = (r = {}) => ({
  academicYearStartMonth: int(r.academicYearStartMonth ?? 6, "academicYearStartMonth", { min: 1, max: 12 }),
  regularMinutesPerYear: int(r.regularMinutesPerYear ?? 0, "regularMinutesPerYear", { max: 100000 }),
  yearsRequired: int(r.yearsRequired ?? 0, "yearsRequired", { max: 6 }),
  consecutiveYears: Boolean(r.consecutiveYears),
  categories: (Array.isArray(r.categories) ? r.categories : []).slice(0, 30).map((c) => ({
    name: str(c.name, 80) || "general",
    minMinutes: int(c.minMinutes ?? 0, "category minimum"),
  })),
  camp: { required: Boolean(r.camp?.required), requiredDays: int(r.camp?.requiredDays ?? 0, "camp days", { max: 60 }) },
  maxClaimMinutesPerDay: int(r.maxClaimMinutesPerDay ?? 720, "maxClaimMinutesPerDay", { min: 1, max: 1440 }),
  complaintWindowDays: int(r.complaintWindowDays ?? 30, "complaintWindowDays", { min: 1, max: 365 }),
  evidenceRequired: Boolean(r.evidenceRequired),
  countLegacy: Boolean(r.countLegacy),
  reportSignatories: (Array.isArray(r.reportSignatories) ? r.reportSignatories : []).slice(0, 10).map((s) => str(s, 120)),
});
export const createPolicy = handle(async (req, res) => {
  requireOfficer(req);
  const b = req.body || {};
  const family = str(b.family, 60) || "nss-certificate";
  if (!["national", "local_academic", "benefit"].includes(b.requirementType)) throw bad("requirementType must be national, local_academic or benefit");
  const doc = {
    institution: inst(req),
    family,
    name: str(b.name, 160),
    purpose: str(b.purpose, 1000),
    requirementType: b.requirementType,
    sourceReference: str(b.sourceReference, 500),
    effectiveFrom: date(b.effectiveFrom, "effectiveFrom"),
    effectiveTo: b.effectiveTo ? date(b.effectiveTo, "effectiveTo") : undefined,
    appliesTo: { programme: str(b.appliesTo?.programme, 120), batch: str(b.appliesTo?.batch, 60) },
    rules: cleanRules(b.rules),
    status: "draft",
    author: req.user._id,
    changeReason: reasonRequired(b.changeReason, "create a policy version"),
    history: [{ action: "created", by: req.user._id, reason: str(b.changeReason, 1000) }],
  };
  if (!doc.name) throw bad("Name is required");
  // Next version number; the unique index settles a race between two authors.
  for (let attempt = 0; attempt < 3; attempt++) {
    const last = await ServicePolicy.findOne({ institution: inst(req), family }).sort({ version: -1 }).select("version").lean();
    try {
      const policy = await ServicePolicy.create({ ...doc, version: (last?.version || 0) + 1 });
      audit(req, "policy.create", "ServicePolicy", policy._id, { family, version: policy.version });
      return res.status(201).json({ success: true, policy });
    } catch (e) {
      if (e?.code !== 11000) throw e;
    }
  }
  throw conflict("Another version was created at the same time; please retry");
});
export const activatePolicy = handle(async (req, res) => {
  requireOfficer(req);
  const reason = reasonRequired(req.body?.reason, "activate a policy");
  const p = await loadOwn(ServicePolicy, req.params.id, req, "policy");
  if (p.status !== "draft") throw conflict("Only a draft can be activated");
  if (p.requirementType === "national" && !p.sourceReference) throw bad("A national requirement needs a source document reference before activation");
  const updated = await ServicePolicy.findOneAndUpdate(
    { _id: p._id, status: "draft" },
    { $set: { status: "active", verifiedByInstitution: Boolean(req.body?.verifiedByInstitution) }, $push: { history: { action: "activated", by: req.user._id, reason } } },
    { new: true }
  );
  if (!updated) throw conflict("Policy changed meanwhile");
  // Older active versions of the same family end where this one starts.
  await ServicePolicy.updateMany(
    { institution: p.institution, family: p.family, status: "active", _id: T({ $ne: p._id }), version: T({ $lt: p.version }) },
    { $set: { status: "retired", effectiveTo: p.effectiveFrom }, $push: { history: { action: "superseded", by: req.user._id, reason: `Superseded by v${p.version}` } } }
  );
  audit(req, "policy.activate", "ServicePolicy", p._id, { version: p.version, reason });
  res.json({ success: true, policy: updated });
});

// ───────── diary (volunteer) ─────────
const DIARY_FIELDS = ["event", "kind", "serviceDate", "claimedMinutes", "category", "workDone", "reflection", "outcomes", "evidence", "externalOrganisation"];
const applyDiaryFields = (entry, body) => {
  const b = pick(body, DIARY_FIELDS);
  if (b.kind !== undefined) {
    if (!["regular", "camp", "external"].includes(b.kind)) throw bad("Invalid kind");
    entry.kind = b.kind;
  }
  if (b.event !== undefined) entry.event = b.event ? oid(b.event, "activity") : undefined;
  if (b.serviceDate !== undefined) entry.serviceDate = date(b.serviceDate, "service date");
  if (b.claimedMinutes !== undefined) entry.claimedMinutes = int(b.claimedMinutes, "Duration (minutes)", { min: 1, max: 1440 });
  for (const k of ["category", "workDone", "reflection", "outcomes", "externalOrganisation"]) if (b[k] !== undefined) entry[k] = str(b[k]);
  if (b.evidence !== undefined) entry.evidence = evidenceList(b.evidence);
};

export const myDiary = handle(async (req, res) => {
  requireVolunteer(req);
  const entries = await DiaryEntry.find({ student: req.user._id }).populate("event", "title date endDate type").sort({ serviceDate: -1 }).limit(500).lean();
  res.json({ success: true, entries });
});
export const createDiary = handle(async (req, res) => {
  requireVolunteer(req);
  const entry = new DiaryEntry({ institution: inst(req), student: req.user._id, status: "draft" });
  applyDiaryFields(entry, req.body);
  if (entry.serviceDate > new Date(Date.now() + 86400000)) throw bad("Service date cannot be in the future");
  await entry.save();
  res.status(201).json({ success: true, entry });
});
export const updateDiary = handle(async (req, res) => {
  requireVolunteer(req);
  const entry = await loadOwn(DiaryEntry, req.params.id, req, "diary entry");
  if (String(entry.student) !== String(req.user._id)) throw notFound("Diary entry not found");
  if (!["draft", "returned"].includes(entry.status)) throw conflict("Only drafts and returned entries can be edited");
  applyDiaryFields(entry, req.body);
  await entry.save();
  res.json({ success: true, entry });
});

// Check a claim against the authorised activity and its attendance record.
const validateClaim = async (req, entry) => {
  if (entry.kind === "external") {
    if (entry.event) throw bad("External service is not linked to an institution activity");
    if (!entry.externalOrganisation) throw bad("Name the organisation for external service");
    return { event: null, check: { present: false, note: "External service — separate officer review" } };
  }
  if (!entry.event) throw bad("Choose the activity this entry is for");
  const event = await Event.findById(entry.event).select("institution type date endDate hours calculatedHours attendance campDays participants status").lean();
  if (!event || !sameInst(req, event)) throw bad("Activity not found");
  if (event.status === "Cancelled") throw bad("This activity was cancelled");
  const kind = event.type === "special_camp" ? "camp" : "regular";
  if (entry.kind !== kind) entry.kind = kind;
  const d = dayKey(entry.serviceDate);
  if (d < dayKey(event.date) || d > dayKey(event.endDate || event.date)) throw bad("The date is outside the activity's dates");
  const me = String(req.user._id);
  let present;
  let maxMinutes;
  // Session records (check-in/out, partial) take precedence over legacy roll calls.
  const session = await AttendanceRecord.findOne({ event: event._id, student: req.user._id, sessionDate: d }).lean();
  if (session) {
    if (session.verification !== "verified") throw bad("Your attendance for that day is waiting for supervisor verification");
    if (!["present", "partial"].includes(session.status)) throw bad("Attendance for that day is recorded as " + session.status + ". If this is wrong, raise an hours complaint.");
    const cap = session.minutes || (kind === "camp" ? toMinutes(event.hours) || 720 : toMinutes(event.calculatedHours) || toMinutes(event.hours) || 0);
    if (cap && entry.claimedMinutes > cap) throw bad(`The claim exceeds your recorded participation (${cap} minutes)`);
    return { event, check: { present: true, note: `Session record: ${session.status}${session.minutes ? `, ${session.minutes} min` : ""}, verified` } };
  }
  if (kind === "camp") {
    const day = (event.campDays || []).find((x) => dayKey(x.date) === d);
    present = Boolean(day && (day.present || []).some((p) => String(p) === me));
    maxMinutes = toMinutes(event.hours) || 720;
  } else {
    present = (event.attendance || []).some((a) => String(a.student) === me && a.status === "Present");
    maxMinutes = toMinutes(event.calculatedHours) || toMinutes(event.hours) || 0;
  }
  if (!present) throw bad("No attendance is recorded for you on that day. If this is wrong, raise an hours complaint.");
  if (maxMinutes && entry.claimedMinutes > maxMinutes) throw bad(`The claim exceeds the session's recorded duration (${maxMinutes} minutes)`);
  return { event, check: { present: true, note: `Attendance found; session up to ${maxMinutes || "?"} min` } };
};

export const submitDiary = handle(async (req, res) => {
  requireVolunteer(req);
  const entry = await loadOwn(DiaryEntry, req.params.id, req, "diary entry");
  if (String(entry.student) !== String(req.user._id)) throw notFound("Diary entry not found");
  if (!canTransition(entry.status, "submitted")) throw conflict("This entry cannot be submitted in its current state");
  if (!entry.workDone) throw bad("Describe the work performed");
  const { check } = await validateClaim(req, entry);
  const policy = await policyFor(inst(req), entry.serviceDate);
  if (policy?.rules?.evidenceRequired && !entry.evidence.length) throw bad("This policy requires supporting evidence");
  const updated = await DiaryEntry.findOneAndUpdate(
    { _id: entry._id, status: entry.status, rev: entry.rev },
    {
      $set: { status: "submitted", kind: entry.kind, attendanceCheck: check },
      $inc: { rev: 1 },
      $push: { revisions: pick(entry.toObject(), ["claimedMinutes", "category", "workDone", "reflection", "outcomes"]) },
    },
    { new: true }
  );
  if (!updated) throw conflict("The entry changed meanwhile; reload and try again");
  res.json({ success: true, entry: updated });
});

// ───────── diary review ─────────
export const reviewQueue = handle(async (req, res) => {
  requireActive(req);
  if (!req.coordinator && !req.teacher) throw forbid();
  const q = { institution: inst(req), status: str(req.query.status, 20) || "submitted" };
  if (req.teacher) {
    const mine = await Event.find({ institution: inst(req), assignedTeacher: req.user._id }).select("_id").lean();
    q.event = T({ $in: mine.map((e) => e._id) });
  }
  const page = Math.max(1, Number(req.query.page) || 1);
  const [entries, total] = await Promise.all([
    DiaryEntry.find(q).populate("student", "name email department").populate("event", "title date type").sort({ updatedAt: 1 }).skip((page - 1) * 50).limit(50).lean(),
    DiaryEntry.countDocuments(q),
  ]);
  res.json({ success: true, entries, total, page });
});

const decideOne = async (req, id, b = {}) => {
  const action = b.action;
  if (!["approve", "return", "reject"].includes(action)) throw bad("Action must be approve, return or reject");
  const entry = await loadOwn(DiaryEntry, id, req, "diary entry");
  const event = entry.event ? await Event.findById(entry.event).select("institution assignedTeacher").lean() : null;
  if (!canReview(req, event)) throw forbid("You are not assigned to review this activity");
  if (entry.kind === "external" && !req.coordinator) throw forbid("External service is reviewed by a Programme Officer");
  if (entry.status !== "submitted") throw conflict(`Already ${entry.status}`);
  if (b.rev !== undefined && Number(b.rev) !== entry.rev) throw conflict("The entry changed since you opened it; reload");

  const to = action === "approve" ? "approved" : action === "return" ? "returned" : "rejected";
  let approvedMinutes;
  let reason = str(b.reason, 1000);
  if (action === "approve") {
    approvedMinutes = int(b.approvedMinutes ?? entry.claimedMinutes, "Approved minutes", { min: 1, max: entry.claimedMinutes });
    if (approvedMinutes < entry.claimedMinutes) reason = reasonRequired(b.reason, "approve fewer minutes than claimed");
  } else {
    reason = reasonRequired(b.reason, action === "return" ? "return an entry" : "reject an entry");
  }
  const policy = await policyFor(inst(req), entry.serviceDate);
  const decision = { action, by: req.user._id, byRole: roleOf(req), reason, approvedMinutes, policyVersion: policy?.version };

  // Compare-and-set: only one reviewer can move a submitted entry.
  const moved = await DiaryEntry.findOneAndUpdate(
    { _id: entry._id, status: "submitted", rev: entry.rev },
    { $set: { status: to }, $inc: { rev: 1 }, $push: { decisions: decision } },
    { new: true }
  );
  if (!moved) throw conflict("Another reviewer decided this entry first");

  if (action === "approve") {
    const startMonth = policy?.rules?.academicYearStartMonth;
    const ay = academicYearFor(entry.serviceDate, startMonth);
    // Lower-school community service enrolments never count as NSS service.
    const enrolments = await Enrolment.find({ student: entry.student, academicYear: ay }).select("level unit _id").lean();
    const nssEnrolment = enrolments.find((x) => x.level !== "community_service");
    const programme = enrolments.length && !nssEnrolment ? "community_service" : "nss";
    try {
      const credit = await LedgerEntry.create({
        programme,
        enrolment: (nssEnrolment || enrolments[0])?._id,
        unit: entry.unit || (nssEnrolment || enrolments[0])?.unit,
        institution: entry.institution,
        student: entry.student,
        event: entry.event,
        diary: entry._id,
        serviceDate: entry.serviceDate,
        academicYear: academicYearFor(entry.serviceDate, startMonth),
        kind: entry.kind === "camp" ? "camp" : "regular",
        category: entry.category || "general",
        entryType: "credit",
        claimedMinutes: entry.claimedMinutes,
        minutes: approvedMinutes,
        policy: policy?._id,
        policyVersion: policy?.version,
        approver: req.user._id,
        approverRole: roleOf(req),
        reason,
        evidence: entry.evidence,
        idempotencyKey: creditKey({ student: entry.student, event: entry.event, serviceDate: entry.serviceDate, diary: entry._id, kind: entry.kind }),
      });
      moved.ledgerEntry = credit._id;
      await DiaryEntry.updateOne({ _id: entry._id }, { $set: { ledgerEntry: credit._id } });
    } catch (e) {
      // Roll the diary back so nothing reads as approved without a credit.
      await DiaryEntry.updateOne({ _id: entry._id, rev: moved.rev }, { $set: { status: "submitted" }, $inc: { rev: 1 }, $pop: { decisions: 1 } });
      if (e?.code === 11000) throw conflict("A credit already exists for this volunteer on this activity and day");
      throw e;
    }
  }
  audit(req, `diary.${action}`, "DiaryEntry", entry._id, { approvedMinutes, reason, policyVersion: policy?.version, bulk: Boolean(b.bulk) });
  return moved;
};

export const decideDiary = handle(async (req, res) => {
  res.json({ success: true, entry: await decideOne(req, req.params.id, req.body || {}) });
});

// Flags that keep an entry out of bulk approval (it must be reviewed alone).
const flagsFor = async (entry) => {
  const flags = [];
  if (entry.kind === "external") flags.push("external service");
  if (entry.revisions?.length > 1) flags.push("resubmitted after return");
  if ((entry.decisions || []).some((d) => d.action === "reject")) flags.push("previously rejected");
  if (entry.event && (await Grievance.exists({ student: entry.student, event: entry.event, status: T({ $in: ["open", "under_review", "escalated"] }) }))) flags.push("open complaint on this activity");
  const session = entry.event ? await AttendanceRecord.findOne({ event: entry.event, student: entry.student, sessionDate: dayKey(entry.serviceDate) }).select("verification corrections conflicts").lean() : null;
  if (session?.conflicts?.length) flags.push("attendance had an offline conflict");
  if (!session && entry.event && !/Session record/.test(entry.attendanceCheck?.note || "")) flags.push("legacy roll call only (no check-in/out)");
  return flags;
};

// Bulk approval: each entry is decided individually (own audit record and
// ledger credit). Flagged entries are skipped, never approved in bulk.
export const bulkApprove = handle(async (req, res) => {
  requireActive(req);
  const items = Array.isArray(req.body?.items) ? req.body.items.slice(0, 100) : [];
  if (!items.length) throw bad("Select entries to approve");
  const note = str(req.body?.note, 300) || "Approved in bulk review";
  const results = [];
  for (const it of items) {
    try {
      const entry = await loadOwn(DiaryEntry, it.id, req, "diary entry");
      const flags = await flagsFor(entry);
      if (flags.length) {
        results.push({ id: it.id, state: "skipped", flags });
        continue;
      }
      await decideOne(req, it.id, { action: "approve", rev: it.rev, reason: note, bulk: true });
      results.push({ id: it.id, state: "approved" });
    } catch (e) {
      results.push({ id: it.id, state: "error", message: e.status ? e.message : "Could not approve" });
    }
  }
  res.json({ success: true, results });
});

export const diaryFlags = handle(async (req, res) => {
  requireActive(req);
  if (!req.coordinator && !req.teacher) throw forbid();
  const ids = String(req.query.ids || "").split(",").filter(Boolean).slice(0, 100);
  const out = {};
  for (const id of ids) {
    const e = await loadOwn(DiaryEntry, id, req, "diary entry");
    out[id] = await flagsFor(e);
  }
  res.json({ success: true, flags: out });
});



// ───────── ledger ─────────
const ledgerFor = (student) => LedgerEntry.find({ student }).sort({ serviceDate: 1, createdAt: 1 }).lean();

const buildPassbook = async (institution, studentId) => {
  const [entries, diaries, policies] = await Promise.all([
    ledgerFor(studentId),
    DiaryEntry.find({ student: studentId, status: T({ $in: ["submitted", "returned", "rejected", "draft"] }) }).populate("event", "title date type").sort({ serviceDate: -1 }).lean(),
    ServicePolicy.find({ institution, status: "active" }).lean(),
  ]);
  const legacyByYear = {};
  for (const e of entries) if (e.entryType === "legacy") legacyByYear[e.academicYear] = (legacyByYear[e.academicYear] || 0) + e.minutes;
  const summary = summariseLedger(entries);
  const camps = await Event.find({ _id: T({ $in: Object.keys(summary.campDays) }) }).select("title date endDate").lean();
  const campProgress = camps.map((c) => {
    const days = new Set(Object.keys(summary.campDays[String(c._id)] || {}));
    return { event: c._id, title: c.title, daysCredited: days.size, missingDays: missingCampDays(c, days) };
  });
  return {
    summary: {
      verifiedRegularMinutes: summary.verifiedRegular,
      verifiedCampMinutes: summary.verifiedCamp,
      legacyMinutes: summary.legacy,
      communityServiceMinutes: summary.communityService,
      pendingMinutes: diaries.filter((d) => d.status === "submitted").reduce((s, d) => s + d.claimedMinutes, 0),
      byYear: Object.entries(summary.byYear).map(([y, m]) => ({ year: Number(y), label: yearLabel(Number(y)), minutes: m })),
      byCategory: summary.byCategory,
    },
    campProgress,
    evaluations: policies.map((p) => ({
      policy: { _id: p._id, name: p.name, version: p.version, requirementType: p.requirementType, verifiedByInstitution: p.verifiedByInstitution, sourceReference: p.sourceReference },
      result: evaluatePolicy(summary, p.rules, { legacyByYear }),
    })),
    entries,
    pending: diaries.filter((d) => d.status === "submitted"),
    returned: diaries.filter((d) => d.status === "returned"),
    rejected: diaries.filter((d) => d.status === "rejected"),
    drafts: diaries.filter((d) => d.status === "draft"),
  };
};

export const myPassbook = handle(async (req, res) => {
  requireVolunteer(req);
  res.json({ success: true, ...(await buildPassbook(inst(req), req.user._id)) });
});
export const studentPassbook = handle(async (req, res) => {
  requireActive(req);
  if (!req.coordinator && !req.teacher) throw forbid();
  const student = await loadOwn(Student, req.params.studentId, req, "volunteer");
  res.json({ success: true, student: { _id: student._id, name: student.name, department: student.department }, ...(await buildPassbook(inst(req), student._id)) });
});

// Signed correction against an existing entry. Requires a client operation id
// so a retried request cannot apply the correction twice.
const writeAdjustment = async (req, original, { minutes, reason, opId, reversal = false, grievance }) => {
  const prior = await LedgerEntry.find({ $or: [{ _id: original._id }, { adjusts: original._id }] }).select("minutes").lean();
  const net = prior.reduce((s, e) => s + e.minutes, 0);
  if (net + minutes < 0) throw bad("A correction cannot take this record below zero");
  return LedgerEntry.create({
    ...pick(original, ["institution", "unit", "student", "enrolment", "event", "diary", "serviceDate", "academicYear", "kind", "category", "policy", "policyVersion"]),
    grievance,
    entryType: reversal ? "reversal" : "adjustment",
    minutes,
    adjusts: original._id,
    approver: req.user._id,
    approverRole: roleOf(req),
    reason,
    idempotencyKey: reversal ? `reversal:${original._id}` : `adjust:${original._id}:${opId}`,
  });
};
export const adjustLedger = handle(async (req, res) => {
  requireOfficer(req);
  const original = await loadOwn(LedgerEntry, req.params.id, req, "ledger entry");
  if (original.adjusts) throw bad("Adjust the original credit, not a correction");
  const reason = reasonRequired(req.body?.reason, "adjust credited service");
  const reversal = Boolean(req.body?.reverse);
  let minutes;
  if (reversal) {
    const prior = await LedgerEntry.find({ $or: [{ _id: original._id }, { adjusts: original._id }] }).select("minutes").lean();
    minutes = -prior.reduce((s, e) => s + e.minutes, 0);
    if (minutes === 0) throw conflict("Nothing left to reverse");
  } else {
    minutes = int(req.body?.minutes, "Adjustment minutes", { min: -1440, max: 1440 });
    if (minutes === 0) throw bad("Adjustment cannot be zero");
  }
  const opId = str(req.body?.opId, 80);
  if (!reversal && !/^[A-Za-z0-9_-]{8,80}$/.test(opId)) throw bad("opId is required for adjustments");
  try {
    const entry = await writeAdjustment(req, original.toObject(), { minutes, reason, opId, reversal });
    audit(req, reversal ? "ledger.reverse" : "ledger.adjust", "LedgerEntry", original._id, { minutes, reason });
    res.status(201).json({ success: true, entry });
  } catch (e) {
    if (e?.code === 11000) {
      const existing = await LedgerEntry.findOne({ idempotencyKey: reversal ? `reversal:${original._id}` : `adjust:${original._id}:${opId}` }).lean();
      return res.status(200).json({ success: true, entry: existing, duplicate: true });
    }
    throw e;
  }
});

// ───────── grievances ─────────
const GRIEVANCE_TYPES = ["missing_attendance", "missing_hours", "incorrect_duration", "category", "returned_or_rejected"];
export const createGrievance = handle(async (req, res) => {
  requireVolunteer(req);
  const b = req.body || {};
  if (!GRIEVANCE_TYPES.includes(b.type)) throw bad("Choose what the complaint is about");
  const explanation = str(b.explanation);
  if (explanation.length < 10) throw bad("Explain the problem (at least 10 characters)");
  const doc = { institution: inst(req), student: req.user._id, type: b.type, explanation, evidence: evidenceList(b.evidence) };
  let refDate;
  if (b.diary) {
    const d = await loadOwn(DiaryEntry, b.diary, req, "diary entry");
    if (String(d.student) !== String(req.user._id)) throw notFound("Diary entry not found");
    doc.diary = d._id;
    doc.event = d.event;
    refDate = d.decisions.at(-1)?.at || d.serviceDate;
  }
  if (b.ledgerEntry) {
    const l = await loadOwn(LedgerEntry, b.ledgerEntry, req, "ledger entry");
    if (String(l.student) !== String(req.user._id)) throw notFound("Ledger entry not found");
    doc.ledgerEntry = l._id;
    doc.event = doc.event || l.event;
    refDate = refDate || l.approvedAt;
  }
  if (b.event && !doc.event) {
    const ev = await loadOwn(Event, b.event, req, "activity");
    doc.event = ev._id;
    refDate = ev.endDate || ev.date;
  }
  if (!doc.event && !doc.diary && !doc.ledgerEntry) throw bad("Reference the activity, diary entry or ledger record");
  if (!refDate && doc.event) refDate = (await Event.findById(doc.event).select("date endDate").lean())?.date;
  const policy = await policyFor(inst(req), new Date(refDate || Date.now()));
  const windowDays = policy?.rules?.complaintWindowDays || 30;
  doc.deadline = new Date(new Date(refDate || Date.now()).getTime() + windowDays * 86400000);
  if (doc.deadline < new Date()) throw bad(`The ${windowDays}-day complaint window for this record has closed`);
  doc.history = [{ action: "raised", by: req.user._id, byRole: "volunteer", note: explanation.slice(0, 200) }];
  const g = await Grievance.create(doc);
  res.status(201).json({ success: true, grievance: g });
});
export const myGrievances = handle(async (req, res) => {
  requireVolunteer(req);
  const grievances = await Grievance.find({ student: req.user._id }).populate("event", "title date").sort({ createdAt: -1 }).lean();
  res.json({ success: true, grievances });
});
export const listGrievances = handle(async (req, res) => {
  requireOfficer(req);
  const q = { institution: inst(req) };
  if (req.query.status) q.status = str(req.query.status, 20);
  const grievances = await Grievance.find(q).populate("student", "name email").populate("event", "title date").sort({ deadline: 1 }).limit(200).lean();
  res.json({ success: true, grievances });
});
export const respondGrievance = handle(async (req, res) => {
  requireOfficer(req);
  const b = req.body || {};
  const g = await loadOwn(Grievance, req.params.id, req, "complaint");
  const final = ["upheld", "dismissed", "withdrawn"];
  if (final.includes(g.status)) throw conflict("This complaint is already resolved");
  const note = reasonRequired(b.note, "respond to a complaint");
  const next = { review: "under_review", escalate: "escalated", uphold: "upheld", dismiss: "dismissed" }[b.action];
  if (!next) throw bad("Action must be review, escalate, uphold or dismiss");

  let adjustment;
  let minutes;
  if (b.action === "uphold" && b.minutesAdjustment !== undefined && Number(b.minutesAdjustment) !== 0) {
    minutes = int(b.minutesAdjustment, "Adjustment minutes", { min: -1440, max: 1440 });
    if (g.ledgerEntry) {
      const original = await LedgerEntry.findById(g.ledgerEntry).lean();
      adjustment = await writeAdjustment(req, original, { minutes, reason: `Complaint ${g._id}: ${note}`, opId: `grievance-${g._id}`, grievance: g._id }).catch(async (e) => {
        if (e?.code === 11000) return LedgerEntry.findOne({ idempotencyKey: `adjust:${original._id}:grievance-${g._id}` }).lean();
        throw e;
      });
    } else if (g.event && minutes > 0) {
      const ev = await Event.findById(g.event).select("date type").lean();
      const serviceDate = b.serviceDate ? date(b.serviceDate, "service date") : ev.date;
      const policy = await policyFor(inst(req), serviceDate);
      try {
        adjustment = await LedgerEntry.create({
          institution: g.institution,
          student: g.student,
          event: g.event,
          grievance: g._id,
          serviceDate,
          academicYear: academicYearFor(serviceDate, policy?.rules?.academicYearStartMonth),
          kind: ev.type === "special_camp" ? "camp" : "regular",
          category: str(b.category, 80) || "general",
          entryType: "credit",
          minutes,
          policy: policy?._id,
          policyVersion: policy?.version,
          approver: req.user._id,
          approverRole: roleOf(req),
          reason: `Complaint ${g._id}: ${note}`,
          idempotencyKey: creditKey({ student: g.student, event: g.event, serviceDate }),
        });
      } catch (e) {
        if (e?.code === 11000) throw conflict("A credit already exists for that day; adjust the existing ledger entry instead");
        throw e;
      }
    } else throw bad("Link the complaint to a ledger entry or activity to apply a correction");
  }

  const set = { status: next };
  if (["upheld", "dismissed"].includes(next)) set.resolution = { decision: next, reason: note, minutesAdjustment: minutes, adjustment: adjustment?._id, at: new Date() };
  if (b.assignTo) set.assignedTo = oid(b.assignTo, "reviewer");
  const updated = await Grievance.findOneAndUpdate(
    { _id: g._id, status: g.status },
    { $set: set, $push: { history: { action: b.action, by: req.user._id, byRole: roleOf(req), note } } },
    { new: true }
  );
  if (!updated) throw conflict("The complaint changed meanwhile; reload");
  audit(req, `grievance.${b.action}`, "Grievance", g._id, { note, minutes });
  res.json({ success: true, grievance: updated });
});

// ───────── Programme Officer workspace ─────────
export const workspace = handle(async (req, res) => {
  requireOfficer(req);
  const institution = inst(req);
  const now = new Date();
  const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const in14 = new Date(startOfDay.getTime() + 14 * 86400000);

  // Filters: unit / batch / academic year narrow the volunteer set via enrolments.
  const f = { unit: req.query.unit ? oid(req.query.unit, "unit") : null, batch: str(req.query.batch, 60), year: req.query.academicYear ? int(req.query.academicYear, "academicYear", { min: 2000, max: 2100 }) : null };
  let studentScope = null;
  if (f.unit || f.batch || f.year) {
    const eq = { institution };
    if (f.unit) eq.unit = f.unit;
    if (f.batch) eq.batch = f.batch;
    if (f.year) eq.academicYear = f.year;
    studentScope = await Enrolment.distinct("student", eq);
  }
  const scoped = (q) => (studentScope ? { ...q, student: T({ $in: studentScope }) } : q);
  const diaryStatus = ["submitted", "returned"].includes(req.query.status) ? req.query.status : null;

  const [today, upcoming, submitted, returned, grievances, camps, volunteers, policy, unattended, projectsPending, campDocs, deadlines, reconciliations, attendanceQueue, units, batches] = await Promise.all([
    Event.find({ institution, status: T({ $ne: "Cancelled" }), date: T({ $lt: new Date(startOfDay.getTime() + 86400000) }), $or: [{ endDate: T({ $gte: startOfDay }) }, { date: T({ $gte: startOfDay }) }] }).select("title date type status location").lean(),
    Event.find({ institution, status: "Upcoming", date: T({ $gte: new Date(startOfDay.getTime() + 86400000), $lt: in14 }) }).select("title date type location assignedTeacher").sort({ date: 1 }).lean(),
    diaryStatus === "returned" ? [] : DiaryEntry.find(scoped({ institution, status: "submitted" })).populate("student", "name").populate("event", "title").sort({ updatedAt: 1 }).limit(20).lean(),
    diaryStatus === "submitted" ? [] : DiaryEntry.find(scoped({ institution, status: "returned" })).populate("student", "name").sort({ updatedAt: 1 }).limit(20).lean(),
    Grievance.find(scoped({ institution, status: T({ $in: ["open", "under_review", "escalated"] }) })).populate("student", "name").sort({ deadline: 1 }).limit(20).lean(),
    CampPlan.find({ institution, status: T({ $in: ["draft", "submitted", "approved", "in_progress", "completed"] }) }).select("title startDate endDate status event materials").sort({ startDate: 1 }).lean(),
    Student.find(studentScope ? { _id: T({ $in: studentScope }), institution } : { institution, role: "volunteer", status: "active" }).select("name").lean(),
    policyFor(institution, now),
    Event.find({ institution, status: "Completed", "attendance.0": T({ $exists: false }), type: "regular" }).select("title date").sort({ date: -1 }).limit(10).lean(),
    Project.find({ institution, status: T({ $in: ["draft", "submitted", "approved", "scheduled", "in_progress"] }), "requiredPermissions.status": "pending" }).select("title requiredPermissions").lean(),
    CampPlan.find({ institution, status: T({ $in: ["approved", "in_progress"] }) }).select("title requiredDocuments guardianPermissionRequired applications documents").lean(),
    ReportingDeadline.find({ institution, status: "open" }).sort({ dueDate: 1 }).limit(20).lean(),
    Reconciliation.countDocuments({ institution, status: "draft" }),
    AttendanceRecord.countDocuments({ institution, verification: T({ $in: ["unverified", "disputed"] }) }),
    NssUnit.find({ institution }).select("code name").lean(),
    Enrolment.distinct("batch", { institution }),
  ]);
  const counts = await Promise.all([DiaryEntry.countDocuments(scoped({ institution, status: "submitted" })), DiaryEntry.countDocuments(scoped({ institution, status: "returned" }))]);
  const unverifiedFinance = await FinanceEntry.countDocuments({ institution, status: "recorded" });

  // Missing camp documents per selected/confirmed volunteer.
  let missingDocs = 0;
  const missingDocCamps = [];
  for (const c of campDocs) {
    const need = new Set([...(c.requiredDocuments || []), ...(c.guardianPermissionRequired ? ["guardian_consent"] : [])]);
    let n = 0;
    for (const a of c.applications.filter((x) => ["selected", "confirmed"].includes(x.status))) {
      const ok = new Set(c.documents.filter((d) => String(d.student) === String(a.student) && d.status === "verified").map((d) => d.type));
      for (const d of need) if (!ok.has(d)) n++;
    }
    if (n) missingDocCamps.push({ _id: c._id, title: c.title, missing: n });
    missingDocs += n;
  }
  const guardianMissing = await Enrolment.countDocuments({ institution, "guardianPermission.required": true, "guardianPermission.received": false, status: T({ $ne: "withdrawn" }) });

  // Deadlines are met by an approved report of that type covering the period.
  const deadlineRows = [];
  for (const d of deadlines) {
    let met = false;
    if (d.reportType) met = Boolean(await GeneratedReport.exists({ institution, type: d.reportType, status: "approved", ...(d.periodFrom ? { "period.from": T({ $lte: d.periodFrom }) } : {}), ...(d.periodTo ? { "period.to": T({ $gte: d.periodTo }) } : {}) }));
    deadlineRows.push({ ...d, met, overdue: !met && d.dueDate < now });
  }

  // Below target uses verified ledger minutes in the current academic year only.
  let belowTarget = [];
  if (policy?.rules?.regularMinutesPerYear) {
    const year = f.year || academicYearFor(now, policy.rules.academicYearStartMonth);
    const sums = await LedgerEntry.aggregate([
      { $match: { institution, academicYear: year, kind: "regular", entryType: { $ne: "legacy" }, programme: { $ne: "community_service" } } },
      { $group: { _id: "$student", minutes: { $sum: "$minutes" } } },
    ]);
    const m = new Map(sums.map((x) => [String(x._id), x.minutes]));
    belowTarget = volunteers
      .map((v) => ({ _id: v._id, name: v.name, minutes: m.get(String(v._id)) || 0 }))
      .filter((v) => v.minutes < policy.rules.regularMinutesPerYear)
      .sort((x, y) => x.minutes - y.minutes);
  }
  res.json({
    success: true,
    filters: { units, batches: batches.filter(Boolean), applied: { unit: f.unit, batch: f.batch, academicYear: f.year, status: diaryStatus } },
    policy: policy ? { _id: policy._id, name: policy.name, version: policy.version, regularMinutesPerYear: policy.rules.regularMinutesPerYear } : null,
    today,
    upcoming,
    submitted: { total: counts[0], items: submitted },
    returned: { total: counts[1], items: returned },
    grievances,
    camps: camps.map((c) => ({ ...c, materialsNeeded: (c.materials || []).filter((m) => m.status === "needed").length, materials: undefined })),
    attendanceMissing: unattended,
    attendanceAwaitingVerification: attendanceQueue,
    permissionsPending: projectsPending.map((p) => ({ _id: p._id, title: p.title, pending: p.requiredPermissions.filter((x) => x.status === "pending").map((x) => x.name) })),
    documentsMissing: { total: missingDocs, camps: missingDocCamps, guardianPermissionsMissing: guardianMissing },
    deadlines: deadlineRows,
    finance: { draftReconciliations: reconciliations, unverifiedEntries: unverifiedFinance },
    belowTarget: { total: belowTarget.length, items: belowTarget.slice(0, 20) },
  });
});

export const createDeadline = handle(async (req, res) => {
  requireOfficer(req);
  const b = req.body || {};
  const d = await ReportingDeadline.create({
    institution: inst(req), title: str(b.title, 200), reportType: str(b.reportType, 40), dueDate: date(b.dueDate, "due date"), recipient: str(b.recipient, 200),
    periodFrom: b.periodFrom ? date(b.periodFrom, "period start") : undefined, periodTo: b.periodTo ? date(b.periodTo, "period end") : undefined, createdBy: req.user._id,
  });
  res.status(201).json({ success: true, deadline: d });
});
export const completeDeadline = handle(async (req, res) => {
  requireOfficer(req);
  const d = await loadOwn(ReportingDeadline, req.params.id, req, "deadline");
  d.status = "done";
  d.doneAt = new Date();
  await d.save();
  audit(req, "deadline.done", "ReportingDeadline", d._id, {});
  res.json({ success: true, deadline: d });
});

// Activities a volunteer can write a diary for (participant or attended).
export const myActivities = handle(async (req, res) => {
  requireVolunteer(req);
  const me = req.user._id;
  const events = await Event.find({
    institution: inst(req),
    status: T({ $in: ["Ongoing", "Completed"] }),
    $or: [{ participants: me }, { "attendance.student": me }, { "campDays.present": me }],
  })
    .select("title date endDate type hours calculatedHours")
    .sort({ date: -1 })
    .limit(200)
    .lean();
  res.json({ success: true, events });
});
