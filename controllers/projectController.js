// Community projects: Draft → Submitted → Approved → Scheduled → In progress
// → Completed → Reviewed → Archived, with Rejected / Cancelled (reasons
// required). Approval uses the institution's configurable chain. Scheduling
// requires every required permission to be resolved and generates session
// Events idempotently.
import mongoose from "mongoose";
import CommunityRequest from "../models/CommunityRequest.js";
import Event from "../models/Event.js";
import Project from "../models/Project.js";
import Student from "../models/Student.js";
import Teacher from "../models/Teacher.js";
import { chainFor, checkCanSign, nextApproval } from "../utils/approvals.js";
import { sessionDates } from "../utils/sessions.js";
import { audit, bad, conflict, date, evidenceList, forbid, handle, inst, int, notFound, oid, reasonRequired, requireActive, requireOfficer, sameInst, str, T } from "../utils/opsHelpers.js";

// Local time of sessions. Default India Standard Time; configurable.
const TZ = process.env.INSTITUTION_TZ_OFFSET || "+05:30";

const isStaff = (req, p) => Boolean(req.coordinator) || (Boolean(req.teacher) && (p.responsibleStaff || []).some((s) => String(s) === String(req.user._id)));
const load = async (req, idv) => {
  const p = await Project.findById(oid(idv, "project"));
  if (!p || !sameInst(req, p)) throw notFound("Project not found");
  return p;
};
const cas = async (p, update, extra = {}) => {
  const u = await Project.findOneAndUpdate({ _id: p._id, rev: p.rev, ...extra }, { ...update, $inc: { rev: 1 } }, { new: true });
  if (!u) throw conflict("The project changed meanwhile; reload and try again");
  return u;
};
const FINAL = ["reviewed", "archived", "rejected", "cancelled"];

const fields = async (req, b, existing) => {
  const out = {};
  if (b.title !== undefined) out.title = str(b.title, 160);
  for (const k of ["description", "goals"]) if (b[k] !== undefined) out[k] = str(b[k]);
  if (b.category !== undefined) out.category = str(b.category, 80) || "general";
  if (b.community !== undefined) out.community = { name: str(b.community?.name, 200), adopted: Boolean(b.community?.adopted), location: str(b.community?.location, 300) };
  if (b.needs !== undefined) out.needs = (b.needs || []).slice(0, 30).map((n) => ({ need: str(n.need, 500), baseline: str(n.baseline, 1000), source: str(n.source, 300) }));
  if (b.partner !== undefined) out.partner = { organisation: str(b.partner?.organisation, 200), contactRole: str(b.partner?.contactRole, 120) };
  if (b.plannedOutcomes !== undefined) out.plannedOutcomes = (b.plannedOutcomes || []).slice(0, 30).map((o) => ({ metric: str(o.metric, 120), unit: str(o.unit, 40), target: Math.max(0, Number(o.target) || 0) }));
  if (b.responsibleStaff !== undefined) {
    const ids = (b.responsibleStaff || []).map((x) => oid(x, "staff"));
    if ((await Teacher.countDocuments({ _id: T({ $in: ids }), institution: inst(req) })) !== ids.length) throw bad("Responsible staff must be teachers of your institution");
    out.responsibleStaff = ids;
  }
  if (b.volunteerTeams !== undefined) {
    const teams = (b.volunteerTeams || []).slice(0, 30).map((t) => ({ name: str(t.name, 80), members: (t.members || []).map((m) => oid(m, "volunteer")) }));
    const all = [...new Set(teams.flatMap((t) => t.members.map(String)))];
    if ((await Student.countDocuments({ _id: T({ $in: all }), institution: inst(req) })) !== all.length) throw bad("Team members must be volunteers of your institution");
    out.volunteerTeams = teams;
  }
  if (b.schedule !== undefined) {
    const s = b.schedule || {};
    const sch = {
      startDate: s.startDate ? date(s.startDate, "start date") : existing?.schedule?.startDate,
      endDate: s.endDate ? date(s.endDate, "end date") : undefined,
      startTime: /^\d{2}:\d{2}$/.test(s.startTime || "") ? s.startTime : "09:00",
      sessionHours: Math.min(24, Math.max(0, Number(s.sessionHours) || 2)),
      recurrence: { freq: ["none", "weekly", "monthly"].includes(s.recurrence?.freq) ? s.recurrence.freq : "none", weekdays: (s.recurrence?.weekdays || []).map(Number).filter((x) => x >= 0 && x <= 6), count: s.recurrence?.count ? int(s.recurrence.count, "Session count", { min: 1, max: 200 }) : undefined },
      location: str(s.location, 300),
    };
    if (sch.endDate && sch.startDate && sch.endDate < sch.startDate) throw bad("End date is before start date");
    out.schedule = sch;
  }
  if (b.capacity !== undefined) out.capacity = int(b.capacity, "Capacity", { min: 1, max: 5000 });
  if (b.budgetEstimatePaise !== undefined) out.budgetEstimatePaise = int(b.budgetEstimatePaise, "Budget estimate (paise)", { max: 1e11 });
  if (b.requiredPermissions !== undefined) out.requiredPermissions = (b.requiredPermissions || []).slice(0, 30).map((x) => ({ name: str(x.name, 160), status: ["pending", "obtained", "not_required"].includes(x.status) ? x.status : "pending", reference: str(x.reference, 300), by: req.user._id, at: new Date() }));
  if (b.documents !== undefined) out.documents = evidenceList(b.documents).map((d) => ({ ...d, kind: "", addedBy: req.user._id }));
  return out;
};

export const listProjects = handle(async (req, res) => {
  requireActive(req);
  const q = { institution: inst(req) };
  if (req.query.status) q.status = str(req.query.status, 20);
  if (req.teacher) q.responsibleStaff = req.user._id;
  else if (req.student) {
    q.status = T({ $in: ["approved", "scheduled", "in_progress", "completed", "reviewed"] });
  } else if (!req.coordinator) throw forbid();
  const projects = await Project.find(q).select("kind title category status community.name schedule.startDate schedule.endDate requiredPermissions followUps updatedAt").sort({ updatedAt: -1 }).limit(300).lean();
  res.json({ success: true, projects });
});

export const createProject = handle(async (req, res) => {
  requireOfficer(req);
  const b = req.body || {};
  if (!["long_running", "recurring", "standalone"].includes(b.kind)) throw bad("Choose long-running, recurring or standalone");
  const data = await fields(req, b);
  if (!data.title) throw bad("Title is required");
  const p = new Project({ institution: inst(req), kind: b.kind, ...data, createdBy: req.user._id, transitions: [{ from: null, to: "draft", by: req.user._id, reason: "Created" }] });
  if (b.communityRequest) {
    const reqDoc = await CommunityRequest.findOneAndUpdate(
      { _id: oid(b.communityRequest, "request"), institution: inst(req), status: "accepted", project: T({ $exists: false }) },
      { $set: { project: p._id } },
      { new: true }
    );
    if (!reqDoc) throw conflict("The request must be accepted and not already linked to a project");
    p.communityRequest = reqDoc._id;
    if (!p.community.name) p.community.name = reqDoc.orgName;
    if (!p.community.location) p.community.location = reqDoc.location;
    if (!p.needs.length) p.needs = [{ need: reqDoc.description.slice(0, 500), baseline: "", source: `Community request from ${reqDoc.orgName}` }];
  }
  await p.save();
  audit(req, "project.create", "Project", p._id, { kind: p.kind, communityRequest: p.communityRequest });
  res.status(201).json({ success: true, project: p });
});

export const getProject = handle(async (req, res) => {
  requireActive(req);
  const p = await load(req, req.params.id);
  if (req.student) {
    if (!["approved", "scheduled", "in_progress", "completed", "reviewed"].includes(p.status)) throw forbid();
    return res.json({ success: true, project: { _id: p._id, title: p.title, description: p.description, kind: p.kind, community: p.community, goals: p.goals, schedule: p.schedule, status: p.status, plannedOutcomes: p.plannedOutcomes } });
  }
  if (!isStaff(req, p)) throw forbid();
  await p.populate([{ path: "responsibleStaff", select: "name" }, { path: "volunteerTeams.members", select: "name" }, { path: "communityRequest", select: "orgName category description location status createdAt" }]);
  const [sessions, chain] = await Promise.all([Event.find({ project: p._id }).select("title date status sessionKey").sort({ date: 1 }).lean(), chainFor(p.institution, "project")]);
  res.json({ success: true, project: p, sessions, approvalChain: chain, nextApproval: nextApproval(chain, p.approvals) });
});

export const updateProject = handle(async (req, res) => {
  requireActive(req);
  const p = await load(req, req.params.id);
  if (!isStaff(req, p)) throw forbid();
  if (FINAL.includes(p.status) || p.status === "completed") throw conflict(`Project is ${p.status}; it can no longer be edited`);
  // After approval only operational sections may change; scope changes need re-approval.
  const b = { ...(req.body || {}) };
  if (!["draft"].includes(p.status)) for (const k of ["title", "kind", "goals", "budgetEstimatePaise", "schedule"]) if (b[k] !== undefined && p.status !== "submitted") throw conflict(`"${k}" can't change after approval; cancel and re-propose if the scope changed`);
  const set = await fields(req, b, p);
  if (!Object.keys(set).length) throw bad("Nothing to update");
  const u = await cas(p, { $set: set });
  audit(req, "project.update", "Project", p._id, Object.keys(set));
  res.json({ success: true, project: u });
});

const scheduleSessions = async (p) => {
  const dates = sessionDates(p.schedule, p.kind);
  if (!dates.length) throw bad("Set a start date (and recurrence) before scheduling");
  const participants = [...new Set(p.volunteerTeams.flatMap((t) => t.members.map(String)))].map((x) => new mongoose.Types.ObjectId(x));
  let created = 0;
  for (const k of dates) {
    try {
      await Event.create({
        title: dates.length > 1 ? `${p.title} — session ${k}` : p.title,
        description: p.description || p.title,
        date: new Date(`${k}T${p.schedule.startTime || "09:00"}:00${TZ}`),
        location: p.schedule.location || p.community.location || p.community.name || "To be confirmed",
        institution: p.institution,
        hours: p.schedule.sessionHours,
        assignedTeacher: p.responsibleStaff,
        participants,
        type: "regular",
        status: "Upcoming",
        project: p._id,
        sessionKey: k,
        communityRequest: p.communityRequest,
        donationOpen: false,
      });
      created++;
    } catch (e) {
      if (e?.code !== 11000) throw e; // already scheduled
    }
  }
  return { created, total: dates.length };
};

export const transitionProject = handle(async (req, res) => {
  requireActive(req);
  const p = await load(req, req.params.id);
  const action = req.body?.action;
  const reason = str(req.body?.reason, 1000);
  if (action === "approve" || action === "reject") {
    if (p.status !== "submitted") throw conflict("Only a submitted project can be decided");
    const chain = await chainFor(p.institution, "project");
    const { error, next } = checkCanSign(req, chain, p.approvals);
    if (error) throw forbid(error);
    if (action === "reject") {
      const r = reasonRequired(reason, "reject a project");
      const u = await cas(p, { $set: { status: "rejected" }, $push: { approvals: { step: next.step.name, by: req.user._id, decision: "rejected", reason: r }, transitions: { from: p.status, to: "rejected", by: req.user._id, reason: r } } }, { status: "submitted" });
      audit(req, "project.reject", "Project", p._id, { reason: r });
      return res.json({ success: true, project: u });
    }
    const last = next.index === chain.length - 1;
    const update = { $push: { approvals: { step: next.step.name, by: req.user._id, decision: "approved", reason } } };
    if (last) {
      update.$set = { status: "approved" };
      update.$push.transitions = { from: "submitted", to: "approved", by: req.user._id, reason };
    }
    const u = await cas(p, update, { status: "submitted" });
    audit(req, "project.approve_step", "Project", p._id, { step: next.step.name, final: last });
    return res.json({ success: true, project: u });
  }
  if (!isStaff(req, p)) throw forbid();
  const moves = { submit: ["draft", "submitted"], schedule: ["approved", "scheduled"], start: ["scheduled", "in_progress"], complete: ["in_progress", "completed"], review: ["completed", "reviewed"], archive: ["reviewed", "archived"] };
  if (action === "cancel") {
    requireOfficer(req);
    if (FINAL.includes(p.status)) throw conflict(`Project is already ${p.status}`);
    const r = reasonRequired(reason, "cancel a project");
    const u = await cas(p, { $set: { status: "cancelled" }, $push: { transitions: { from: p.status, to: "cancelled", by: req.user._id, reason: r } } });
    await Event.updateMany({ project: p._id, status: "Upcoming" }, { $set: { status: "Cancelled" } });
    audit(req, "project.cancel", "Project", p._id, { reason: r });
    return res.json({ success: true, project: u });
  }
  if (!moves[action]) throw bad("Unknown action");
  if (["submit", "schedule", "review", "archive"].includes(action)) requireOfficer(req);
  const [from, to] = moves[action];
  if (p.status !== from) throw conflict(`Project must be ${from.replace("_", " ")} to ${action}`);
  const set = { status: to };
  let sessions;
  if (action === "submit" && !p.schedule?.startDate) throw bad("Add a schedule before submitting");
  if (action === "schedule") {
    const pending = p.requiredPermissions.filter((x) => x.status === "pending");
    if (pending.length) throw bad(`Permissions still pending: ${pending.map((x) => x.name).join(", ")}`);
    sessions = await scheduleSessions(p);
  }
  if (action === "review") {
    const summary = reasonRequired(req.body?.summary || reason, "review a project (write a summary)");
    set.review = { summary, by: req.user._id, at: new Date() };
  }
  if (action === "submit") set.approvals = [];
  const u = await cas(p, { $set: set, $push: { transitions: { from, to, by: req.user._id, reason } } }, { status: from });
  audit(req, `project.${action}`, "Project", p._id, { reason, sessions });
  res.json({ success: true, project: u, sessions });
});

// Long-running projects add sessions one at a time (idempotent per date).
export const addSession = handle(async (req, res) => {
  requireActive(req);
  const p = await load(req, req.params.id);
  if (!isStaff(req, p)) throw forbid();
  if (!["scheduled", "in_progress"].includes(p.status)) throw conflict("Sessions can be added once the project is scheduled");
  const d = date(req.body?.date, "session date").toISOString().slice(0, 10);
  const r = await scheduleSessions({ ...p.toObject(), kind: "standalone", schedule: { ...p.schedule.toObject(), startDate: d } });
  res.status(r.created ? 201 : 200).json({ success: true, ...r });
});

export const updateFollowUps = handle(async (req, res) => {
  requireActive(req);
  const p = await load(req, req.params.id);
  if (!isStaff(req, p)) throw forbid();
  if (["archived", "cancelled", "rejected"].includes(p.status)) throw conflict(`Project is ${p.status}`);
  const b = req.body || {};
  let u;
  if (b.task) {
    u = await cas(p, { $push: { followUps: { task: str(b.task, 300), due: b.due ? date(b.due, "due date") : undefined, assignee: b.assignee ? oid(b.assignee, "assignee") : undefined } } });
  } else if (b.followUpId) {
    u = await Project.findOneAndUpdate({ _id: p._id, "followUps._id": oid(b.followUpId, "follow-up") }, { $set: { "followUps.$.status": "done", "followUps.$.doneAt": new Date() }, $inc: { rev: 1 } }, { new: true });
    if (!u) throw bad("Follow-up not found");
  } else throw bad("Send a task to add, or followUpId to complete");
  res.json({ success: true, project: u });
});
