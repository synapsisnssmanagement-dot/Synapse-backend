// Outcome reporting, verification, partner confirmation, follow-ups and
// publication. Attendance is never treated as impact.
import Event from "../models/Event.js";
import OutcomeRecord from "../models/OutcomeRecord.js";
import Project from "../models/Project.js";
import { audit, bad, conflict, date, evidenceList, forbid, handle, inst, loadOwn, oid, reasonRequired, requireActive, requireOfficer, str } from "../utils/opsHelpers.js";

const isStaff = (req, p) => Boolean(req.coordinator) || (Boolean(req.teacher) && (p.responsibleStaff || []).some((s) => String(s) === String(req.user._id)));
const isTeamMember = (req, p) => Boolean(req.student) && (p.volunteerTeams || []).some((t) => t.members.some((m) => String(m) === String(req.user._id)));
const ACTIVE = ["scheduled", "in_progress", "completed", "reviewed"];

export const listOutcomes = handle(async (req, res) => {
  requireActive(req);
  const p = await loadOwn(Project, req.params.id, req, "project");
  let q = { project: p._id };
  if (!isStaff(req, p)) {
    if (!isTeamMember(req, p)) throw forbid();
    q = { project: p._id, $or: [{ reportedBy: req.user._id }, { "verification.status": "verified" }] };
  }
  const records = await OutcomeRecord.find(q).sort({ observedAt: -1 }).lean();
  // Summary per metric: planned vs reported vs verified vs follow-up.
  const sum = new Map();
  const k = (m, u) => `${m.toLowerCase()}|${(u || "").toLowerCase()}`;
  for (const o of p.plannedOutcomes) sum.set(k(o.metric, o.unit), { metric: o.metric, unit: o.unit, planned: o.target, reported: 0, verified: 0, followup: 0, partnerConfirmed: 0 });
  for (const r of records) {
    const key = k(r.metric, r.unit);
    const s = sum.get(key) || { metric: r.metric, unit: r.unit, planned: null, reported: 0, verified: 0, followup: 0, partnerConfirmed: 0 };
    if (r.verification.status === "rejected") continue;
    if (r.level === "followup") {
      if (r.verification.status === "verified") s.followup += r.value;
    } else {
      s.reported += r.value;
      if (r.verification.status === "verified") s.verified += r.value;
      if (r.partnerConfirmation?.confirmed) s.partnerConfirmed += r.value;
    }
    sum.set(key, s);
  }
  res.json({ success: true, records, summary: [...sum.values()] });
});

export const reportOutcome = handle(async (req, res) => {
  requireActive(req);
  const p = await loadOwn(Project, req.params.id, req, "project");
  if (!isStaff(req, p) && !isTeamMember(req, p)) throw forbid("Only the project's staff and volunteer team report outcomes");
  if (!ACTIVE.includes(p.status)) throw conflict("Outcomes are recorded once the project is scheduled");
  const b = req.body || {};
  const value = Number(b.value);
  if (!Number.isFinite(value) || value < 0 || value > 1e9) throw bad("Value must be a non-negative number");
  const metric = str(b.metric, 120);
  if (!metric) throw bad("Name the metric (e.g. Trees planted)");
  const doc = {
    institution: inst(req), project: p._id, metric, unit: str(b.unit, 40), value, observedAt: date(b.observedAt || new Date(), "observation date"),
    note: str(b.note, 1000), evidence: evidenceList(b.evidence), reportedBy: req.user._id, reporterRole: req.user.role, level: "reported",
  };
  if (b.event) {
    const ev = await Event.findOne({ _id: oid(b.event, "session"), project: p._id }).select("_id").lean();
    if (!ev) throw bad("Session does not belong to this project");
    doc.event = ev._id;
  }
  if (b.followUpOf) {
    if (!isStaff(req, p)) throw forbid("Follow-up observations are recorded by staff");
    const orig = await OutcomeRecord.findOne({ _id: oid(b.followUpOf, "outcome"), project: p._id, "verification.status": "verified" }).lean();
    if (!orig) throw bad("A follow-up must refer to a verified outcome of this project");
    if (doc.observedAt <= orig.observedAt) throw bad("A follow-up must be observed after the original");
    doc.level = "followup";
    doc.followUpOf = orig._id;
  }
  const r = await OutcomeRecord.create(doc);
  res.status(201).json({ success: true, outcome: r });
});

export const verifyOutcome = handle(async (req, res) => {
  requireActive(req);
  const o = await loadOwn(OutcomeRecord, req.params.outcomeId, req, "outcome");
  const p = await Project.findById(o.project).lean();
  if (!isStaff(req, p)) throw forbid();
  if (String(o.reportedBy) === String(req.user._id)) throw forbid("Someone other than the reporter verifies an outcome");
  const decision = req.body?.decision;
  if (!["verified", "rejected"].includes(decision)) throw bad("Decision must be verified or rejected");
  const reason = decision === "rejected" ? reasonRequired(req.body?.reason, "reject an outcome") : str(req.body?.reason, 500);
  const set = { verification: { status: decision, by: req.user._id, at: new Date(), reason } };
  if (req.body?.value !== undefined && decision === "verified") {
    const v = Number(req.body.value);
    if (!Number.isFinite(v) || v < 0) throw bad("Invalid value");
    if (v !== o.value) {
      reasonRequired(req.body?.reason, "verify a different value than reported");
      set.value = v;
      set.note = `${o.note ? `${o.note} · ` : ""}Reported ${o.value}, verified ${v}: ${req.body.reason}`;
    }
  }
  const u = await OutcomeRecord.findOneAndUpdate({ _id: o._id, rev: o.rev, "verification.status": "pending" }, { $set: set, $inc: { rev: 1 } }, { new: true });
  if (!u) throw conflict("Already decided");
  audit(req, `outcome.${decision}`, "OutcomeRecord", o._id, { reason });
  res.json({ success: true, outcome: u });
});

export const partnerConfirm = handle(async (req, res) => {
  requireActive(req);
  const o = await loadOwn(OutcomeRecord, req.params.outcomeId, req, "outcome");
  const p = await Project.findById(o.project).lean();
  if (!isStaff(req, p)) throw forbid();
  if (o.verification.status !== "verified") throw conflict("Verify the outcome before recording partner confirmation");
  const partnerRole = str(req.body?.partnerRole, 120);
  if (!partnerRole) throw bad("Record the partner's role (e.g. Panchayat secretary)");
  const u = await OutcomeRecord.findByIdAndUpdate(o._id, { $set: { partnerConfirmation: { confirmed: true, partnerRole, note: str(req.body?.note, 500), recordedBy: req.user._id, at: new Date() } }, $inc: { rev: 1 } }, { new: true });
  audit(req, "outcome.partner_confirm", "OutcomeRecord", o._id, { partnerRole });
  res.json({ success: true, outcome: u });
});

export const publishOutcome = handle(async (req, res) => {
  requireOfficer(req);
  const o = await loadOwn(OutcomeRecord, req.params.outcomeId, req, "outcome");
  if (o.verification.status !== "verified") throw conflict("Only verified outcomes can be published");
  const approved = req.body?.approved !== false;
  const u = await OutcomeRecord.findByIdAndUpdate(o._id, { $set: { publication: { approved, by: req.user._id, at: new Date() } }, $inc: { rev: 1 } }, { new: true });
  audit(req, approved ? "outcome.publish" : "outcome.unpublish", "OutcomeRecord", o._id, {});
  res.json({ success: true, outcome: u });
});

// Legacy event impact figures → public only after officer approval.
export const approveLegacyImpact = handle(async (req, res) => {
  requireOfficer(req);
  const ev = await loadOwn(Event, req.params.eventId, req, "activity");
  const approved = req.body?.approved !== false;
  await Event.updateOne({ _id: ev._id }, { $set: { impactPublicApproved: approved, impactPublicApprovedBy: req.user._id } });
  audit(req, "event.impact_public", "Event", ev._id, { approved });
  res.json({ success: true });
});

