import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { client, startEnv } from "./harness.js";
import { TAG, baseFixtures } from "./fixtures.js";
import AttendanceRecord from "../models/AttendanceRecord.js";
import Event from "../models/Event.js";
import LedgerEntry from "../models/LedgerEntry.js";

let env, call, F, ev, live;
const day = "2025-09-14";

before(async () => {
  env = await startEnv();
  call = client(env.base);
  F = await baseFixtures();
  ev = await Event.create({ title: `${TAG} Cleanup`, description: "x", date: new Date(`${day}T03:00:00Z`), location: "x", institution: F.instA._id, hours: 4, calculatedHours: 4, status: "Completed", assignedTeacher: [F.teacher._id], participants: [F.vol._id, F.vol2._id] });
  live = await Event.create({ title: `${TAG} Live`, description: "x", date: new Date(), location: "x", institution: F.instA._id, hours: 2, status: "Ongoing", participants: [F.vol._id], geo: { lat: 10, lng: 76, radius: 300 } });
});
after(() => env?.stop());

const op = (over) => ({ opId: `op-${Math.random().toString(36).slice(2, 12)}`, event: ev._id, student: F.vol._id, sessionDate: day, status: "partial", checkInAt: `${day}T03:00:00Z`, checkOutAt: `${day}T05:30:00Z`, offline: true, ...over });

test("offline batch: idempotent replay, partial minutes, legacy mirror", async () => {
  const o = op();
  let r = await call("POST", "/api/ops/attendance/sync", F.t.teacher, { ops: [o] });
  assert.equal(r.data.results[0].state, "synced");
  // Reconnect / reload replays the same op: no duplicate.
  r = await call("POST", "/api/ops/attendance/sync", F.t.teacher, { ops: [o] });
  assert.equal(r.data.results[0].state, "duplicate");
  const recs = await AttendanceRecord.find({ event: ev._id }).lean();
  assert.equal(recs.length, 1);
  assert.equal(recs[0].minutes, 150);
  assert.equal(recs[0].method, "offline_supervisor");
  const e = await Event.findById(ev._id).lean();
  assert.equal(e.attendance.find((a) => String(a.student) === String(F.vol._id)).status, "Present");
});

test("conflicting offline edit keeps both versions and blocks claims until resolved", async () => {
  const rec = await AttendanceRecord.findOne({ event: ev._id, student: F.vol._id });
  // Officer corrects online (rev 0 → 1)
  let r = await call("POST", `/api/ops/attendance/${rec._id}/correct`, F.t.po, { status: "partial", minutes: 120, reason: "Left early per register", rev: 0 });
  assert.equal(r.status, 200);
  // A device that last saw rev 0 sends a different version.
  const stale = op({ status: "present", checkOutAt: `${day}T07:00:00Z`, baseRev: 0 });
  r = await call("POST", "/api/ops/attendance/sync", F.t.teacher, { ops: [stale] });
  assert.equal(r.data.results[0].state, "conflict");
  let after = await AttendanceRecord.findById(rec._id).lean();
  assert.equal(after.minutes, 120, "server copy not overwritten");
  assert.equal(after.conflicts.length, 1);
  assert.equal(after.conflicts[0].incoming.minutes, 240, "incoming copy preserved");
  assert.equal(after.verification, "disputed");

  // Diary claim is blocked while disputed.
  const d = (await call("POST", "/api/ops/diary", F.t.vol, { event: ev._id, serviceDate: day, claimedMinutes: 120, workDone: "Cleanup" })).data.entry;
  assert.equal((await call("POST", `/api/ops/diary/${d._id}/submit`, F.t.vol)).status, 400);

  // Unassigned teacher cannot resolve; assigned one can.
  assert.equal((await call("POST", `/api/ops/attendance/${rec._id}/resolve`, F.t.otherTeacher, { opId: stale.opId, keep: "server", reason: "x x x" })).status, 403);
  r = await call("POST", `/api/ops/attendance/${rec._id}/resolve`, F.t.teacher, { opId: stale.opId, keep: "server", reason: "Register is authoritative" });
  assert.equal(r.status, 200);
  after = await AttendanceRecord.findById(rec._id).lean();
  assert.equal(after.verification, "verified");
  assert.equal(after.conflicts[0].resolved, true);

  // Claim now capped at recorded 120 minutes.
  await call("PATCH", `/api/ops/diary/${d._id}`, F.t.vol, { claimedMinutes: 200 });
  assert.equal((await call("POST", `/api/ops/diary/${d._id}/submit`, F.t.vol)).status, 400);
  await call("PATCH", `/api/ops/diary/${d._id}`, F.t.vol, { claimedMinutes: 120 });
  assert.equal((await call("POST", `/api/ops/diary/${d._id}/submit`, F.t.vol)).status, 200);
  assert.equal((await call("POST", `/api/ops/diary/${d._id}/decide`, F.t.teacher, { action: "approve" })).status, 200);
  assert.equal(await LedgerEntry.countDocuments({ student: F.vol._id }), 1);
});

test("supervisor marks a volunteer without a phone; absent cannot claim", async () => {
  const r = await call("POST", "/api/ops/attendance/sync", F.t.teacher, { ops: [op({ student: F.vol2._id, status: "absent", checkInAt: null, checkOutAt: null, offline: false })] });
  assert.equal(r.data.results[0].state, "synced");
  const d = (await call("POST", "/api/ops/diary", F.t.vol2, { event: ev._id, serviceDate: day, claimedMinutes: 60, workDone: "x" })).data.entry;
  assert.equal((await call("POST", `/api/ops/diary/${d._id}/submit`, F.t.vol2)).status, 400);
});

test("authorisation: unassigned teacher, other institution, non-roster student", async () => {
  let r = await call("POST", "/api/ops/attendance/sync", F.t.otherTeacher, { ops: [op()] });
  assert.equal(r.data.results[0].state, "error");
  r = await call("POST", "/api/ops/attendance/sync", F.t.poB, { ops: [op()] });
  assert.equal(r.data.results[0].state, "error");
  r = await call("POST", "/api/ops/attendance/sync", F.t.po, { ops: [op({ student: F.volB._id })] });
  assert.equal(r.data.results[0].state, "error");
  assert.equal((await call("GET", `/api/ops/attendance/roster?event=${ev._id}`, F.t.otherTeacher)).status, 403);
  assert.equal((await call("POST", "/api/ops/attendance/sync", F.t.vol, { ops: [op()] })).status, 403);
});

test("self check-in: denied location is recorded as unverified, not rejected; GPS is evidence only", async () => {
  let r = await call("POST", "/api/ops/attendance/self/in", F.t.vol, { event: live._id, locationError: "Permission denied" });
  assert.equal(r.status, 201);
  assert.equal(r.data.record.verification, "unverified");
  assert.equal(r.data.record.method, "self_no_location");
  assert.equal(r.data.needsSupervisor, true);
  assert.equal((await call("POST", "/api/ops/attendance/self/in", F.t.vol, { event: live._id })).status, 409);
  r = await call("POST", "/api/ops/attendance/self/out", F.t.vol, { event: live._id });
  assert.equal(r.status, 200);
  assert.equal((await call("POST", "/api/ops/attendance/self/out", F.t.vol, { event: live._id })).status, 409);
  assert.equal((await call("POST", "/api/ops/attendance/self/in", F.t.vol2, { event: live._id })).status, 403, "not on roster");
});

test("volunteer live list shows ongoing events with venue range and today's record", async () => {
  const r = await call("GET", "/api/ops/attendance/live", F.t.vol);
  assert.equal(r.status, 200);
  const ev = r.data.events.find((e) => String(e._id) === String(live._id));
  assert.equal(ev.geo.radius, 300);
  assert.ok(ev.record?.checkInAt, "today's check-in included");
  assert.equal((await call("GET", "/api/ops/attendance/live", F.t.vol2)).data.events.length, 0, "not on roster → not listed");
  assert.equal((await call("GET", "/api/ops/attendance/live", F.t.teacher)).status, 403);
});
