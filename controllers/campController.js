// Special camp operations: proposal → approval chain → camp event, volunteer
// selection with waiting list, documents (status only), restricted emergency
// contacts and incidents, teams/logistics/budget, closing report and
// per-volunteer completion review from verified evidence.
import mongoose from "mongoose";
import CampPlan from "../models/CampPlan.js";
import Enrolment from "../models/Enrolment.js";
import Event from "../models/Event.js";
import Incident from "../models/Incident.js";
import LedgerEntry from "../models/LedgerEntry.js";
import Student from "../models/Student.js";
import Teacher from "../models/Teacher.js";
import { chainFor, checkCanSign, nextApproval } from "../utils/approvals.js";
import { activePolicy } from "../utils/ledgerTotals.js";
import { dayKey, missingCampDays } from "../utils/serviceRules.js";
import { audit, bad, conflict, date, forbid, handle, inst, int, loadOwn, notFound, oid, reasonRequired, requireActive, requireOfficer, requireVolunteer, sameInst, str, T } from "../utils/opsHelpers.js";

const PRIVATE = "-emergencyContacts";
const isCampSupervisor = (req, plan) => Boolean(req.teacher) && (plan.supervisors || []).some((s) => String(s) === String(req.user._id));
const requireStaff = (req, plan) => {
  requireActive(req);
  if (!req.coordinator && !isCampSupervisor(req, plan)) throw forbid("Programme Officers and this camp's supervisors only");
};
const loadPlan = async (req, id, select = PRIVATE) => {
  const p = await CampPlan.findById(oid(id, "camp")).select(select);
  if (!p || !sameInst(req, p)) throw notFound("Camp not found");
  return p;
};
const editable = (p) => {
  if (["completed", "reviewed", "rejected", "cancelled"].includes(p.status)) throw conflict(`Camp is ${p.status}; it can no longer be edited`);
};
const cas = async (plan, update, extra = {}, options = {}) => {
  const updated = await CampPlan.findOneAndUpdate({ _id: plan._id, rev: plan.rev, ...extra }, { ...update, $inc: { rev: 1 } }, { new: true, projection: PRIVATE, ...options });
  if (!updated) throw conflict("The camp changed meanwhile; reload and try again");
  return updated;
};
const activeCount = (p) => p.applications.filter((a) => ["selected", "confirmed"].includes(a.status)).length;

export const listCamps = handle(async (req, res) => {
  requireActive(req);
  const q = { institution: inst(req) };
  if (req.student) q.status = T({ $in: ["approved", "in_progress", "completed", "reviewed"] });
  else if (req.teacher) q.supervisors = req.user._id;
  else if (!req.coordinator) throw forbid();
  const camps = await CampPlan.find(q).select("title startDate endDate status capacity event applications.student applications.status site.community").sort({ startDate: -1 }).lean();
  // Volunteers see counts and their own application only.
  const out = camps.map((c) => {
    const base = { ...c, applicationCounts: c.applications.reduce((a, x) => ({ ...a, [x.status]: (a[x.status] || 0) + 1 }), {}) };
    if (req.student) {
      base.myApplication = c.applications.find((a) => String(a.student) === String(req.user._id)) || null;
      delete base.applications;
    }
    return base;
  });
  res.json({ success: true, camps: out });
});

export const createCamp = handle(async (req, res) => {
  requireOfficer(req);
  const b = req.body || {};
  const startDate = date(b.startDate, "start date");
  const endDate = date(b.endDate, "end date");
  if (endDate < startDate) throw bad("End date is before start date");
  const supervisors = (Array.isArray(b.supervisors) ? b.supervisors : []).map((x) => oid(x, "supervisor"));
  if (supervisors.length && (await Teacher.countDocuments({ _id: T({ $in: supervisors }), institution: inst(req) })) !== supervisors.length) throw bad("Supervisors must be teachers of your institution");
  const plan = await CampPlan.create({
    institution: inst(req),
    title: str(b.title, 160),
    startDate,
    endDate,
    capacity: int(b.capacity, "Capacity", { min: 1, max: 1000 }),
    hoursPerDay: b.hoursPerDay != null ? Number(b.hoursPerDay) : 6,
    site: { community: str(b.site?.community, 200), address: str(b.site?.address, 500), hostOrganisation: str(b.site?.hostOrganisation, 200), hostContactRole: str(b.site?.hostContactRole, 120), needs: str(b.site?.needs, 2000) },
    objectives: str(b.objectives),
    guardianPermissionRequired: Boolean(b.guardianPermissionRequired),
    requiredDocuments: (Array.isArray(b.requiredDocuments) ? b.requiredDocuments : []).filter((d) => ["guardian_consent", "fitness_declaration", "institution_permission", "id_proof"].includes(d)),
    supervisors,
    transitions: [{ from: null, to: "draft", by: req.user._id, reason: "Created" }],
  });
  audit(req, "camp.create", "CampPlan", plan._id, { title: plan.title });
  res.status(201).json({ success: true, camp: await CampPlan.findById(plan._id).select(PRIVATE) });
});

export const getCamp = handle(async (req, res) => {
  requireActive(req);
  const plan = await loadPlan(req, req.params.id);
  if (req.student) {
    if (!["approved", "in_progress", "completed", "reviewed"].includes(plan.status)) throw notFound("Camp not found");
    const mine = plan.applications.find((a) => String(a.student) === String(req.user._id));
    return res.json({
      success: true,
      camp: {
        _id: plan._id, title: plan.title, startDate: plan.startDate, endDate: plan.endDate, status: plan.status, site: { community: plan.site.community },
        programme: plan.programme, requiredDocuments: plan.requiredDocuments, guardianPermissionRequired: plan.guardianPermissionRequired,
        myApplication: mine || null, myDocuments: plan.documents.filter((d) => String(d.student) === String(req.user._id)),
        myTeam: plan.teams.filter((t) => t.members.some((m) => String(m) === String(req.user._id))).map((t) => ({ name: t.name, duties: t.duties })),
      },
    });
  }
  requireStaff(req, plan);
  await plan.populate([{ path: "applications.student", select: "name department" }, { path: "supervisors", select: "name" }]);
  const chain = await chainFor(plan.institution, "camp");
  res.json({ success: true, camp: plan, approvalChain: chain, nextApproval: nextApproval(chain, plan.approvals) });
});

// Whitelisted planning sections.
const SECTIONS = {
  programme: (v) => (Array.isArray(v) ? v : []).slice(0, 60).map((d) => ({ date: str(d.date, 10), items: (d.items || []).slice(0, 30).map((i) => ({ time: str(i.time, 10), activity: str(i.activity, 300), lead: str(i.lead, 120) })) })),
  meals: (v) => (Array.isArray(v) ? v : []).slice(0, 200).map((m) => ({ date: str(m.date, 10), meal: str(m.meal, 40), headcount: Math.max(0, Number(m.headcount) || 0), notes: str(m.notes, 300) })),
  transport: (v) => (Array.isArray(v) ? v : []).slice(0, 100).map((t) => ({ date: str(t.date, 10), mode: str(t.mode, 60), from: str(t.from, 120), to: str(t.to, 120), notes: str(t.notes, 300) })),
  materials: (v) => (Array.isArray(v) ? v : []).slice(0, 300).map((m) => ({ item: str(m.item, 120), quantity: Math.max(0, Number(m.quantity) || 0), unit: str(m.unit, 30), status: ["needed", "arranged", "received", "returned"].includes(m.status) ? m.status : "needed" })),
  budget: (v) => (Array.isArray(v) ? v : []).slice(0, 100).map((x) => ({ head: str(x.head, 120), estimatePaise: int(x.estimatePaise ?? 0, "Budget estimate (paise)", { max: 1e11 }) })),
  objectives: (v) => str(v),
  capacity: (v) => int(v, "Capacity", { min: 1, max: 1000 }),
};
export const updateCamp = handle(async (req, res) => {
  const plan = await loadPlan(req, req.params.id);
  requireStaff(req, plan);
  editable(plan);
  const set = {};
  for (const [k, fn] of Object.entries(SECTIONS)) if (req.body?.[k] !== undefined) set[k] = fn(req.body[k]);
  if (req.body?.teams !== undefined) {
    const ids = new Set(plan.applications.filter((a) => a.status === "confirmed").map((a) => String(a.student)));
    set.teams = (req.body.teams || []).slice(0, 50).map((t) => {
      const members = (t.members || []).map((m) => oid(m, "member"));
      if (members.some((m) => !ids.has(String(m)))) throw bad("Team members must be confirmed camp volunteers");
      if (t.supervisor && !plan.supervisors.some((s) => String(s) === String(t.supervisor))) throw bad("Team supervisor must be a camp supervisor");
      return { name: str(t.name, 80), supervisor: t.supervisor ? oid(t.supervisor, "supervisor") : undefined, members, duties: str(t.duties, 1000) };
    });
  }
  if (set.capacity && set.capacity < activeCount(plan)) throw bad("Capacity is below the number already selected");
  if (!Object.keys(set).length) throw bad("Nothing to update");
  const updated = await cas(plan, { $set: set });
  audit(req, "camp.update", "CampPlan", plan._id, Object.keys(set));
  res.json({ success: true, camp: updated });
});

// Lifecycle. submit (officer) → approve (chain) | reject → start → complete → review; cancel.
export const transitionCamp = handle(async (req, res) => {
  const plan = await loadPlan(req, req.params.id);
  const action = req.body?.action;
  const reason = str(req.body?.reason, 1000);
  requireActive(req);
  if (action === "submit") {
    requireOfficer(req);
    if (plan.status !== "draft") throw conflict("Only a draft can be submitted");
    const updated = await cas(plan, { $set: { status: "submitted", approvals: [] }, $push: { transitions: { from: plan.status, to: "submitted", by: req.user._id, reason } } });
    return res.json({ success: true, camp: updated });
  }
  if (action === "approve" || action === "reject") {
    if (plan.status !== "submitted") throw conflict("Only a submitted proposal can be decided");
    const chain = await chainFor(plan.institution, "camp");
    const { error, next } = checkCanSign(req, chain, plan.approvals);
    if (error) throw forbid(error);
    if (action === "reject") {
      const r = reasonRequired(reason, "reject a proposal");
      const updated = await cas(plan, { $set: { status: "rejected" }, $push: { approvals: { step: next.step.name, by: req.user._id, decision: "rejected", reason: r }, transitions: { from: "submitted", to: "rejected", by: req.user._id, reason: r } } }, { status: "submitted" });
      audit(req, "camp.reject", "CampPlan", plan._id, { reason: r });
      return res.json({ success: true, camp: updated });
    }
    const last = next.index === chain.length - 1;
    const update = { $push: { approvals: { step: next.step.name, by: req.user._id, decision: "approved", reason } } };
    if (last) {
      update.$set = { status: "approved" };
      update.$push.transitions = { from: "submitted", to: "approved", by: req.user._id, reason };
    }
    let updated = await cas(plan, update, { status: "submitted" });
    if (last) {
      const ev = await Event.create({
        title: plan.title, description: plan.objectives || plan.title, date: plan.startDate, endDate: plan.endDate,
        location: plan.site.community || plan.site.address || "Camp site", institution: plan.institution, type: "special_camp",
        hours: plan.hoursPerDay, assignedTeacher: plan.supervisors, status: "Upcoming", donationOpen: false,
      });
      updated = await CampPlan.findByIdAndUpdate(plan._id, { $set: { event: ev._id } }, { new: true, projection: PRIVATE });
    }
    audit(req, "camp.approve_step", "CampPlan", plan._id, { step: next.step.name, final: last });
    return res.json({ success: true, camp: updated });
  }
  const moves = { start: ["approved", "in_progress"], complete: ["in_progress", "completed"], cancel: [null, "cancelled"] };
  if (!moves[action]) throw bad("Unknown action");
  requireOfficer(req);
  const [from, to] = moves[action];
  if (from && plan.status !== from) throw conflict(`Camp must be ${from} to ${action}`);
  if (action === "cancel") {
    if (["completed", "reviewed", "cancelled"].includes(plan.status)) throw conflict("Camp can no longer be cancelled");
    reasonRequired(reason, "cancel a camp");
  }
  const updated = await cas(plan, { $set: { status: to }, $push: { transitions: { from: plan.status, to, by: req.user._id, reason } } });
  if (plan.event) {
    const evStatus = { in_progress: "Ongoing", completed: "Completed", cancelled: "Cancelled" }[to];
    if (evStatus) await Event.updateOne({ _id: plan.event }, { $set: { status: evStatus } });
  }
  audit(req, `camp.${action}`, "CampPlan", plan._id, { reason });
  res.json({ success: true, camp: updated });
});

// Volunteer applies; over capacity goes to the waiting list automatically.
export const applyToCamp = handle(async (req, res) => {
  requireVolunteer(req);
  const plan = await loadPlan(req, req.params.id);
  if (plan.status !== "approved") throw conflict("Applications are open only for approved camps that have not started");
  if (plan.applications.some((a) => String(a.student) === String(req.user._id) && a.status !== "withdrawn")) throw conflict("You have already applied");
  const updated = await CampPlan.findOneAndUpdate(
    { _id: plan._id, status: "approved", "applications.student": T({ $ne: req.user._id }) },
    { $push: { applications: { student: req.user._id, status: "applied" } }, $inc: { rev: 1 } },
    { new: true, projection: PRIVATE }
  );
  if (!updated) throw conflict("You have already applied");
  res.status(201).json({ success: true });
});

const docsComplete = async (plan, studentId) => {
  const needed = new Set(plan.requiredDocuments);
  if (plan.guardianPermissionRequired) needed.add("guardian_consent");
  // Class XI/XII enrolments always need guardian consent.
  if (await Enrolment.exists({ student: studentId, level: T({ $in: ["XI", "XII"] }) })) needed.add("guardian_consent");
  const ok = new Set(plan.documents.filter((d) => String(d.student) === String(studentId) && d.status === "verified").map((d) => d.type));
  return [...needed].filter((n) => !ok.has(n));
};

// Officer decides an application: select | confirm | waitlist | decline | withdraw.
export const decideApplication = handle(async (req, res) => {
  const plan = await loadPlan(req, req.params.id);
  requireOfficer(req);
  editable(plan);
  const sid = String(oid(req.body?.student, "volunteer"));
  const app = plan.applications.find((a) => String(a.student) === sid);
  if (!app) throw notFound("Application not found");
  const action = req.body?.action;
  let status = { select: "selected", confirm: "confirmed", waitlist: "waitlisted", decline: "declined", withdraw: "withdrawn" }[action];
  if (!status) throw bad("Invalid action");
  if (status === "selected" && !["selected", "confirmed"].includes(app.status) && activeCount(plan) >= plan.capacity) status = "waitlisted";
  if (status === "confirmed") {
    if (!["selected", "confirmed"].includes(app.status)) throw bad("Select the volunteer before confirming");
    const missing = await docsComplete(plan, sid);
    if (missing.length) throw bad(`Required documents not verified: ${missing.join(", ")}`);
  }
  const set = { "applications.$[a].status": status, "applications.$[a].decidedBy": req.user._id, "applications.$[a].note": str(req.body?.note, 300) };
  const filters = { arrayFilters: [{ "a.student": new mongoose.Types.ObjectId(sid) }] };
  let updated = await cas(plan, { $set: set }, {}, filters);
  // Keep the camp event roster equal to confirmed volunteers.
  if (plan.event) {
    if (status === "confirmed") await Event.updateOne({ _id: plan.event }, { $addToSet: { participants: new mongoose.Types.ObjectId(sid) } });
    else await Event.updateOne({ _id: plan.event }, { $pull: { participants: new mongoose.Types.ObjectId(sid) } });
  }
  // A freed place goes to the earliest waitlisted applicant.
  if (["withdrawn", "declined"].includes(status) && ["selected", "confirmed"].includes(app.status)) {
    const next = updated.applications.filter((a) => a.status === "waitlisted").sort((x, y) => x.appliedAt - y.appliedAt)[0];
    if (next) {
      updated = await cas(updated, { $set: { "applications.$[a].status": "selected", "applications.$[a].note": "Promoted from waiting list" } }, {}, { arrayFilters: [{ "a.student": next.student }] });
    }
  }
  audit(req, "camp.application", "CampPlan", plan._id, { student: sid, status });
  res.json({ success: true, status, camp: updated });
});

// Document status (no files stored here).
export const recordDocument = handle(async (req, res) => {
  const plan = await loadPlan(req, req.params.id);
  requireStaff(req, plan);
  const type = req.body?.type;
  if (!["guardian_consent", "fitness_declaration", "institution_permission", "id_proof"].includes(type)) throw bad("Invalid document type");
  const status = req.body?.status;
  if (!["pending", "received", "verified", "rejected"].includes(status)) throw bad("Invalid status");
  const sid = oid(req.body?.student, "volunteer");
  if (!plan.applications.some((a) => String(a.student) === String(sid))) throw bad("Volunteer has not applied to this camp");
  const updated = await cas(plan, { $push: { documents: { student: sid, type, status, note: str(req.body?.note, 300), by: req.user._id } } });
  res.json({ success: true, camp: updated });
});

// Restricted: emergency contacts for officers and this camp's supervisors only.
export const getEmergencyContacts = handle(async (req, res) => {
  const plan = await loadPlan(req, req.params.id, "institution supervisors emergencyContacts");
  requireStaff(req, plan);
  await plan.populate("emergencyContacts.student", "name");
  audit(req, "camp.emergency_contacts.view", "CampPlan", plan._id, {});
  res.set("Cache-Control", "no-store");
  res.json({ success: true, contacts: plan.emergencyContacts });
});
// A volunteer sets their own contact; staff may set any applicant's.
export const setEmergencyContact = handle(async (req, res) => {
  const plan = await loadPlan(req, req.params.id, "institution supervisors applications emergencyContacts rev");
  requireActive(req);
  const sid = req.student ? req.user._id : oid(req.body?.student, "volunteer");
  if (!req.student) requireStaff(req, plan);
  if (!plan.applications.some((a) => String(a.student) === String(sid))) throw bad("Only camp applicants have emergency contacts here");
  const phone = str(req.body?.phone, 20);
  if (!/^[0-9+\-\s]{6,20}$/.test(phone)) throw bad("Enter a valid phone number");
  const entry = { student: sid, name: str(req.body?.name, 120), relation: str(req.body?.relation, 60), phone, updatedBy: req.user._id, at: new Date() };
  await CampPlan.updateOne({ _id: plan._id }, { $pull: { emergencyContacts: { student: sid } } });
  await CampPlan.updateOne({ _id: plan._id }, { $push: { emergencyContacts: entry }, $inc: { rev: 1 } });
  res.json({ success: true });
});

// Incidents (restricted).
export const reportIncident = handle(async (req, res) => {
  const plan = await loadPlan(req, req.params.id);
  requireActive(req);
  const participant = req.student && plan.applications.some((a) => String(a.student) === String(req.user._id) && a.status === "confirmed");
  if (!participant && !req.coordinator && !isCampSupervisor(req, plan)) throw forbid();
  const b = req.body || {};
  const incident = await Incident.create({
    institution: plan.institution, camp: plan._id, event: plan.event,
    occurredAt: date(b.occurredAt, "time of incident"),
    category: b.category, severity: b.severity, description: str(b.description), actionsTaken: str(b.actionsTaken),
    involved: (b.involved || []).map((x) => oid(x, "volunteer")).filter((x) => plan.applications.some((a) => String(a.student) === String(x))),
    reportedBy: req.user._id, reporterRole: req.user.role,
  });
  audit(req, "incident.report", "Incident", incident._id, { severity: incident.severity });
  res.status(201).json({ success: true, incident: { _id: incident._id, status: incident.status } });
});
export const listIncidents = handle(async (req, res) => {
  const plan = await loadPlan(req, req.params.id);
  requireActive(req);
  if (req.student) {
    const mine = await Incident.find({ camp: plan._id, reportedBy: req.user._id }).select("occurredAt category severity status createdAt").lean();
    return res.json({ success: true, incidents: mine });
  }
  requireStaff(req, plan);
  const incidents = await Incident.find({ camp: plan._id }).populate("involved", "name").sort({ occurredAt: -1 }).lean();
  res.set("Cache-Control", "no-store");
  res.json({ success: true, incidents });
});
export const updateIncident = handle(async (req, res) => {
  const inc = await loadOwn(Incident, req.params.incidentId, req, "incident");
  const plan = await loadPlan(req, inc.camp);
  requireStaff(req, plan);
  const note = reasonRequired(req.body?.note, "update an incident");
  const set = {};
  if (req.body?.status && ["open", "closed"].includes(req.body.status)) set.status = req.body.status;
  if (req.body?.actionsTaken !== undefined) set.actionsTaken = str(req.body.actionsTaken);
  await Incident.updateOne({ _id: inc._id }, { $set: set, $push: { updates: { by: req.user._id, note } } });
  audit(req, "incident.update", "Incident", inc._id, set);
  res.json({ success: true });
});

// Per-volunteer completion from verified camp credits. Missing days are
// listed; exceptions need a reason and policy basis.
const completionRows = async (plan) => {
  const confirmed = plan.applications.filter((a) => a.status === "confirmed").map((a) => a.student);
  const policy = await activePolicy(plan.institution, plan.startDate);
  const required = policy?.rules?.camp?.requiredDays || Math.round((plan.endDate - plan.startDate) / 86400000) + 1;
  const credits = plan.event ? await LedgerEntry.find({ event: plan.event, kind: "camp", entryType: T({ $ne: "legacy" }) }).select("student serviceDate minutes").lean() : [];
  const ev = { date: plan.startDate, endDate: plan.endDate };
  return {
    requiredDays: required,
    policy: policy ? { name: policy.name, version: policy.version } : null,
    rows: confirmed.map((sid) => {
      const net = new Map();
      for (const c of credits.filter((c) => String(c.student) === String(sid))) net.set(dayKey(c.serviceDate), (net.get(dayKey(c.serviceDate)) || 0) + c.minutes);
      const days = new Set([...net].filter(([, m]) => m > 0).map(([d]) => d));
      const decision = [...plan.completionDecisions].reverse().find((d) => String(d.student) === String(sid)) || null;
      return { student: sid, daysCredited: days.size, missingDays: missingCampDays(ev, days), meetsRequirement: days.size >= required, decision };
    }),
  };
};
export const completionReview = handle(async (req, res) => {
  const plan = await loadPlan(req, req.params.id);
  requireStaff(req, plan);
  await plan.populate("applications.student", "name");
  const names = new Map(plan.applications.map((a) => [String(a.student?._id || a.student), a.student?.name]));
  plan.applications.forEach((a) => (a.student = a.student?._id || a.student));
  const r = await completionRows(plan);
  res.json({ success: true, ...r, rows: r.rows.map((x) => ({ ...x, name: names.get(String(x.student)) })) });
});
export const decideCompletion = handle(async (req, res) => {
  const plan = await loadPlan(req, req.params.id);
  requireOfficer(req);
  if (!["completed", "reviewed"].includes(plan.status)) throw conflict("Complete the camp before recording completion decisions");
  const sid = String(oid(req.body?.student, "volunteer"));
  const { rows } = await completionRows(plan);
  const row = rows.find((r) => String(r.student) === sid);
  if (!row) throw notFound("Not a confirmed camp volunteer");
  const decision = req.body?.decision;
  if (!["complete", "incomplete", "exception"].includes(decision)) throw bad("Invalid decision");
  if (decision === "complete" && !row.meetsRequirement) throw bad(`Only ${row.daysCredited} verified days; missing ${row.missingDays.join(", ")}. Record an exception with its policy basis instead.`);
  const entry = { student: sid, decision, daysCredited: row.daysCredited, missingDays: row.missingDays, by: req.user._id, reason: str(req.body?.reason, 1000) };
  if (decision === "exception") {
    entry.reason = reasonRequired(req.body?.reason, "record an exception");
    entry.basis = reasonRequired(req.body?.basis, "state the policy basis");
  }
  await cas(plan, { $push: { completionDecisions: entry } });
  audit(req, "camp.completion_decision", "CampPlan", plan._id, entry);
  res.json({ success: true, decision: entry });
});

export const closingReport = handle(async (req, res) => {
  const plan = await loadPlan(req, req.params.id);
  requireActive(req);
  const action = req.body?.action || "submit";
  if (action === "submit") {
    requireStaff(req, plan);
    if (plan.status !== "completed") throw conflict("Submit the closing report after the camp is completed");
    const r = { summary: str(req.body?.summary), outcomes: str(req.body?.outcomes), issues: str(req.body?.issues), submittedBy: req.user._id, submittedAt: new Date() };
    if (r.summary.length < 10) throw bad("Write a summary");
    return res.json({ success: true, camp: await cas(plan, { $set: { closingReport: r } }) });
  }
  if (action === "review") {
    requireOfficer(req);
    if (!plan.closingReport?.submittedAt) throw conflict("No closing report submitted");
    if (String(plan.closingReport.submittedBy) === String(req.user._id) && plan.supervisors.length) throw forbid("The closing report is reviewed by someone other than its author");
    const updated = await cas(plan, { $set: { status: "reviewed", "closingReport.reviewedBy": req.user._id, "closingReport.reviewedAt": new Date(), "closingReport.reviewNotes": str(req.body?.notes, 2000) }, $push: { transitions: { from: plan.status, to: "reviewed", by: req.user._id, reason: str(req.body?.notes, 300) } } }, { status: "completed" });
    audit(req, "camp.review", "CampPlan", plan._id, {});
    return res.json({ success: true, camp: updated });
  }
  throw bad("Invalid action");
});
