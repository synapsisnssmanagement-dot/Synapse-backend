// Session attendance: supervisor capture (online and offline batches),
// volunteer self check-in/out, verification, corrections and conflicts.
import AttendanceRecord from "../models/AttendanceRecord.js";
import Event from "../models/Event.js";
import Student from "../models/Student.js";
import { distanceMetres } from "../utils/nss.js";
import { dayKey } from "../utils/serviceRules.js";
import { audit, bad, conflict, forbid, handle, inst, loadOwn, notFound, oid, reasonRequired, requireActive, requireVolunteer, sameInst, str, T } from "../utils/opsHelpers.js";

const STATUSES = ["present", "partial", "absent", "excused"];
const MAX_BATCH = 200;

const isSupervisorOf = (req, event) =>
  (req.user.status === undefined || req.user.status === "active") &&
  sameInst(req, event) &&
  (Boolean(req.coordinator) || (Boolean(req.teacher) && (event.assignedTeacher || []).some((t) => String(t) === String(req.user._id))));

const loadEvent = async (req, id) => {
  const event = await Event.findById(oid(id, "activity")).select("institution title date endDate type status assignedTeacher participants geo hours calculatedHours").lean();
  if (!event || !sameInst(req, event)) throw notFound("Activity not found");
  return event;
};
const sessionKey = (event, value) => {
  const k = dayKey(value ? new Date(value) : new Date());
  if (k < dayKey(event.date) || k > dayKey(event.endDate || event.date)) throw bad("That date is outside the activity's dates");
  return k;
};
const minutesBetween = (a, b) => (a && b && b > a ? Math.min(1440, Math.round((b - a) / 60000)) : undefined);
const cleanSnapshot = (o = {}) => {
  if (!STATUSES.includes(o.status)) throw bad("Invalid attendance status");
  const checkInAt = o.checkInAt ? new Date(o.checkInAt) : undefined;
  const checkOutAt = o.checkOutAt ? new Date(o.checkOutAt) : undefined;
  if ((checkInAt && Number.isNaN(checkInAt.getTime())) || (checkOutAt && Number.isNaN(checkOutAt.getTime()))) throw bad("Invalid time");
  if (checkInAt && checkOutAt && checkOutAt < checkInAt) throw bad("Check-out is before check-in");
  let minutes = o.minutes != null && o.minutes !== "" ? Number(o.minutes) : minutesBetween(checkInAt, checkOutAt);
  if (minutes != null && (!Number.isInteger(minutes) || minutes < 0 || minutes > 1440)) throw bad("Minutes must be a whole number between 0 and 1440");
  if (o.status === "partial" && !minutes) throw bad("Partial attendance needs minutes or check-in and check-out times");
  if (["absent", "excused"].includes(o.status)) minutes = 0;
  return { status: o.status, checkInAt, checkOutAt, minutes };
};
const same = (a, b) =>
  a.status === b.status && (a.minutes ?? null) === (b.minutes ?? null) && +a.checkInAt === +b.checkInAt && +a.checkOutAt === +b.checkOutAt;

// Keep legacy Event.attendance consistent for older screens.
const mirrorLegacy = async (rec) => {
  const status = ["present", "partial"].includes(rec.status) ? "Present" : "Absent";
  const r = await Event.updateOne({ _id: rec.event, "attendance.student": rec.student }, { $set: { "attendance.$.status": status } });
  if (!r.matchedCount) await Event.updateOne({ _id: rec.event, "attendance.student": T({ $ne: rec.student }) }, { $push: { attendance: { student: rec.student, status } } });
};

// ── supervisor roster for a session
export const roster = handle(async (req, res) => {
  requireActive(req);
  const event = await loadEvent(req, req.query.event);
  if (!isSupervisorOf(req, event)) throw forbid("You are not assigned to this activity");
  const sessionDate = sessionKey(event, req.query.date || event.date);
  const [students, records] = await Promise.all([
    Student.find({ _id: T({ $in: event.participants || [] }), institution: inst(req) }).select("name department").lean(),
    AttendanceRecord.find({ event: event._id, sessionDate }).lean(),
  ]);
  res.json({ success: true, event: { _id: event._id, title: event.title, date: event.date, endDate: event.endDate, type: event.type }, sessionDate, students, records });
});

// ── online or offline batch from a supervisor. Each op:
//    { opId, event, student, sessionDate, status, checkInAt, checkOutAt, minutes, baseRev, capturedAt }
// Results per op: synced | duplicate | conflict | error. Never overwrites a
// record changed since the client's baseRev; the incoming copy is kept instead.
export const syncAttendance = handle(async (req, res) => {
  requireActive(req);
  if (!req.coordinator && !req.teacher) throw forbid();
  const ops = Array.isArray(req.body?.ops) ? req.body.ops : [];
  if (!ops.length || ops.length > MAX_BATCH) throw bad(`Send between 1 and ${MAX_BATCH} operations`);
  const events = new Map();
  const results = [];
  for (const op of ops) {
    const opId = str(op?.opId, 80);
    try {
      if (!/^[A-Za-z0-9_-]{8,80}$/.test(opId)) throw bad("Invalid opId");
      if (!events.has(String(op.event))) events.set(String(op.event), await loadEvent(req, op.event));
      const event = events.get(String(op.event));
      if (!isSupervisorOf(req, event)) throw forbid("Not assigned to this activity");
      const studentId = oid(op.student, "volunteer");
      if (!(event.participants || []).some((p) => String(p) === String(studentId))) throw bad("Volunteer is not on this activity's roster");
      const sessionDate = sessionKey(event, op.sessionDate);
      const incoming = cleanSnapshot(op);

      if (await AttendanceRecord.exists({ appliedOps: opId })) {
        results.push({ opId, state: "duplicate" });
        continue;
      }
      const existing = await AttendanceRecord.findOne({ event: event._id, student: studentId, sessionDate });
      if (!existing) {
        try {
          const rec = await AttendanceRecord.create({
            institution: event.institution, event: event._id, student: studentId, sessionDate, ...incoming,
            method: op.offline ? "offline_supervisor" : "supervisor", recordedBy: req.user._id, appliedOps: [opId],
            verification: "verified", verifiedBy: req.user._id, verifiedAt: new Date(),
          });
          await mirrorLegacy(rec);
          results.push({ opId, state: "synced", id: rec._id, rev: rec.rev });
          continue;
        } catch (e) {
          if (e?.code !== 11000) throw e;
          // Created concurrently: fall through to the update path.
        }
      }
      const current = existing || (await AttendanceRecord.findOne({ event: event._id, student: studentId, sessionDate }));
      if (same(current, incoming)) {
        await AttendanceRecord.updateOne({ _id: current._id }, { $addToSet: { appliedOps: opId } });
        results.push({ opId, state: "synced", id: current._id, rev: current.rev });
        continue;
      }
      const baseRev = op.baseRev == null ? null : Number(op.baseRev);
      if (baseRev !== current.rev) {
        // Someone changed it since this device saw it: keep both versions.
        await AttendanceRecord.updateOne(
          { _id: current._id },
          { $push: { conflicts: { opId, by: req.user._id, incoming, capturedAt: op.capturedAt ? new Date(op.capturedAt) : undefined } }, $addToSet: { appliedOps: opId }, $set: { verification: "disputed" } }
        );
        results.push({ opId, state: "conflict", id: current._id, server: { status: current.status, minutes: current.minutes, rev: current.rev } });
        continue;
      }
      const updated = await AttendanceRecord.findOneAndUpdate(
        { _id: current._id, rev: baseRev },
        {
          $set: { ...incoming, recordedBy: req.user._id, verification: "verified", verifiedBy: req.user._id, verifiedAt: new Date() },
          $inc: { rev: 1 },
          $addToSet: { appliedOps: opId },
          $push: { corrections: { by: req.user._id, reason: `Supervisor update (op ${opId})`, before: { status: current.status, checkInAt: current.checkInAt, checkOutAt: current.checkOutAt, minutes: current.minutes }, after: incoming } },
        },
        { new: true }
      );
      if (!updated) {
        await AttendanceRecord.updateOne({ _id: current._id }, { $push: { conflicts: { opId, by: req.user._id, incoming } }, $addToSet: { appliedOps: opId } });
        results.push({ opId, state: "conflict", id: current._id });
        continue;
      }
      await mirrorLegacy(updated);
      results.push({ opId, state: "synced", id: updated._id, rev: updated.rev });
    } catch (e) {
      results.push({ opId, state: "error", message: e.status ? e.message : "Could not apply" });
    }
  }
  audit(req, "attendance.sync", "Event", null, { count: ops.length, states: results.reduce((a, r) => ({ ...a, [r.state]: (a[r.state] || 0) + 1 }), {}) });
  res.json({ success: true, results });
});

// ── correction with reason (officer or assigned supervisor)
export const correctAttendance = handle(async (req, res) => {
  requireActive(req);
  const rec = await loadOwn(AttendanceRecord, req.params.id, req, "attendance record");
  const event = await loadEvent(req, rec.event);
  if (!isSupervisorOf(req, event)) throw forbid("You are not assigned to this activity");
  const reason = reasonRequired(req.body?.reason, "correct attendance");
  const next = cleanSnapshot({ ...req.body });
  const before = { status: rec.status, checkInAt: rec.checkInAt, checkOutAt: rec.checkOutAt, minutes: rec.minutes };
  const updated = await AttendanceRecord.findOneAndUpdate(
    { _id: rec._id, rev: Number(req.body?.rev ?? rec.rev) },
    { $set: { ...next, method: "manual_correction", verification: "verified", verifiedBy: req.user._id, verifiedAt: new Date() }, $inc: { rev: 1 }, $push: { corrections: { by: req.user._id, reason, before, after: next } } },
    { new: true }
  );
  if (!updated) throw conflict("The record changed since you opened it; reload");
  await mirrorLegacy(updated);
  audit(req, "attendance.correct", "AttendanceRecord", rec._id, { reason, before, after: next });
  res.json({ success: true, record: updated });
});

// ── resolve an offline conflict: keep server, or apply the incoming copy
export const resolveConflict = handle(async (req, res) => {
  requireActive(req);
  const rec = await loadOwn(AttendanceRecord, req.params.id, req, "attendance record");
  const event = await loadEvent(req, rec.event);
  if (!isSupervisorOf(req, event)) throw forbid("You are not assigned to this activity");
  const reason = reasonRequired(req.body?.reason, "resolve a conflict");
  const c = rec.conflicts.find((x) => x.opId === req.body?.opId && !x.resolved);
  if (!c) throw notFound("Open conflict not found");
  const keep = req.body?.keep === "incoming" ? "incoming" : "server";
  const set = { "conflicts.$[c].resolved": true, "conflicts.$[c].resolution": `${keep}: ${reason}` };
  const update = { $set: set, $inc: { rev: 1 } };
  if (keep === "incoming") {
    const inc = c.incoming.toObject ? c.incoming.toObject() : c.incoming;
    Object.assign(set, { status: inc.status, checkInAt: inc.checkInAt, checkOutAt: inc.checkOutAt, minutes: inc.minutes });
    update.$push = { corrections: { by: req.user._id, reason: `Conflict resolved (incoming): ${reason}`, before: { status: rec.status, checkInAt: rec.checkInAt, checkOutAt: rec.checkOutAt, minutes: rec.minutes }, after: inc } };
  }
  const open = rec.conflicts.filter((x) => !x.resolved).length;
  if (open <= 1) set.verification = "verified";
  const updated = await AttendanceRecord.findOneAndUpdate({ _id: rec._id, rev: rec.rev }, update, { new: true, arrayFilters: [{ "c.opId": c.opId }] });
  if (!updated) throw conflict("The record changed meanwhile; reload");
  await mirrorLegacy(updated);
  audit(req, "attendance.resolve_conflict", "AttendanceRecord", rec._id, { keep, reason });
  res.json({ success: true, record: updated });
});

// ── volunteer self check-in / check-out. GPS is evidence, not proof:
// missing or inaccurate location still records the check-in, flagged for a
// supervisor to verify.
const geoEvidence = (event, body) => {
  if (event.geo?.lat == null) return { note: "No venue pin set" };
  const lat = Number(body?.lat);
  const lng = Number(body?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { note: str(body?.locationError, 120) || "Location not shared" };
  const accuracy = Number(body?.accuracy) || null;
  const distance = Math.round(distanceMetres({ lat, lng }, event.geo));
  return { lat: Math.round(lat * 1000) / 1000, lng: Math.round(lng * 1000) / 1000, accuracy, distance, withinRadius: distance <= (event.geo.radius || 300) + Math.min(accuracy || 0, 200), note: accuracy > 200 ? "Low accuracy" : "" };
};
export const selfCheck = handle(async (req, res) => {
  requireVolunteer(req);
  const action = req.params.action;
  if (!["in", "out"].includes(action)) throw notFound();
  const event = await loadEvent(req, req.body?.event);
  if (event.status !== "Ongoing") throw bad("Check-in is open only while the activity is live");
  if (!(event.participants || []).some((p) => String(p) === String(req.user._id))) throw forbid("You are not on this activity's roster");
  const sessionDate = sessionKey(event, new Date());
  const geo = geoEvidence(event, req.body);
  const now = new Date();
  if (action === "in") {
    try {
      const rec = await AttendanceRecord.create({
        institution: event.institution, event: event._id, student: req.user._id, sessionDate, status: "present", checkInAt: now,
        method: geo.lat != null ? "self_gps" : "self_no_location", geo, recordedBy: req.user._id, verification: "unverified",
      });
      return res.status(201).json({ success: true, record: rec, needsSupervisor: !geo.withinRadius });
    } catch (e) {
      if (e?.code === 11000) throw conflict("You have already checked in for today");
      throw e;
    }
  }
  const rec = await AttendanceRecord.findOne({ event: event._id, student: req.user._id, sessionDate });
  if (!rec?.checkInAt) throw bad("Check in first");
  if (rec.checkOutAt) throw conflict("Already checked out");
  const minutes = minutesBetween(rec.checkInAt, now) || 0;
  const updated = await AttendanceRecord.findOneAndUpdate(
    { _id: rec._id, rev: rec.rev, checkOutAt: null },
    { $set: { checkOutAt: now, minutes }, $inc: { rev: 1 } },
    { new: true }
  );
  if (!updated) throw conflict("Already checked out");
  res.json({ success: true, record: updated });
});

// ── supervisor verifies self check-ins
export const verifyAttendance = handle(async (req, res) => {
  requireActive(req);
  const rec = await loadOwn(AttendanceRecord, req.params.id, req, "attendance record");
  const event = await loadEvent(req, rec.event);
  if (!isSupervisorOf(req, event)) throw forbid("You are not assigned to this activity");
  if (rec.verification === "disputed") throw conflict("Resolve the conflict first");
  const updated = await AttendanceRecord.findOneAndUpdate({ _id: rec._id, rev: rec.rev }, { $set: { verification: "verified", verifiedBy: req.user._id, verifiedAt: new Date() }, $inc: { rev: 1 } }, { new: true });
  if (!updated) throw conflict("The record changed meanwhile");
  await mirrorLegacy(updated);
  res.json({ success: true, record: updated });
});

export const myAttendance = handle(async (req, res) => {
  requireVolunteer(req);
  const records = await AttendanceRecord.find({ student: req.user._id }).populate("event", "title date").sort({ sessionDate: -1 }).limit(300).select("-appliedOps -conflicts.by").lean();
  res.json({ success: true, records });
});

// Activities this supervisor may take attendance for.
export const supervisedActivities = handle(async (req, res) => {
  requireActive(req);
  if (!req.coordinator && !req.teacher) throw forbid();
  const q = { institution: inst(req), status: T({ $ne: "Cancelled" }), date: T({ $gte: new Date(Date.now() - 120 * 86400000) }) };
  if (req.teacher) q.assignedTeacher = req.user._id;
  const events = await Event.find(q).select("title date endDate type status").sort({ date: -1 }).limit(200).lean();
  res.json({ success: true, events });
});

// Open offline conflicts and unverified self check-ins awaiting a supervisor.
export const attendanceQueue = handle(async (req, res) => {
  requireActive(req);
  if (!req.coordinator && !req.teacher) throw forbid();
  const q = { institution: inst(req), verification: T({ $in: ["unverified", "disputed"] }) };
  if (req.teacher) {
    const mine = await Event.find({ institution: inst(req), assignedTeacher: req.user._id }).select("_id").lean();
    q.event = T({ $in: mine.map((e) => e._id) });
  }
  const records = await AttendanceRecord.find(q).populate("student", "name").populate("event", "title").sort({ updatedAt: -1 }).limit(200).select("-appliedOps").lean();
  res.json({ success: true, records });
});
