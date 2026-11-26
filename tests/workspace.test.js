import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { client, startEnv } from "./harness.js";
import { TAG, activePolicy, baseFixtures } from "./fixtures.js";
import AttendanceRecord from "../models/AttendanceRecord.js";
import AuditLog from "../models/AuditLog.js";
import Enrolment from "../models/Enrolment.js";
import Event from "../models/Event.js";
import Grievance from "../models/Grievance.js";
import LedgerEntry from "../models/LedgerEntry.js";
import NssUnit from "../models/NssUnit.js";
import Project from "../models/Project.js";

let env, call, F, ev, unit;

before(async () => {
  env = await startEnv();
  call = client(env.base);
  F = await baseFixtures();
  await activePolicy(F.instA, F.po);
  unit = await NssUnit.create({ institution: F.instA._id, name: "U", code: "U1" });
  await Enrolment.create({ institution: F.instA._id, unit: unit._id, student: F.vol._id, academicYear: 2025, batch: "B1" });
  ev = await Event.create({ title: `${TAG} Session`, description: "x", date: new Date("2025-08-10T04:00:00Z"), location: "x", institution: F.instA._id, calculatedHours: 3, status: "Completed", participants: [F.vol._id, F.vol2._id], assignedTeacher: [F.teacher._id] });
  for (const s of [F.vol, F.vol2]) await AttendanceRecord.create({ institution: F.instA._id, event: ev._id, student: s._id, sessionDate: "2025-08-10", status: "present", minutes: 180, method: "supervisor", verification: "verified" });
  await Project.create({ institution: F.instA._id, kind: "standalone", title: `${TAG} P`, status: "approved", requiredPermissions: [{ name: "Panchayat letter", status: "pending" }] });
});
after(() => env?.stop());

const submit = async (t) => {
  const d = (await call("POST", "/api/ops/diary", t, { event: ev._id, serviceDate: "2025-08-10", claimedMinutes: 180, workDone: "Survey" })).data.entry;
  return (await call("POST", `/api/ops/diary/${d._id}/submit`, t)).data.entry;
};

test("bulk approval decides individually and skips flagged entries", async () => {
  const a = await submit(F.t.vol);
  const b = await submit(F.t.vol2);
  await Grievance.create({ institution: F.instA._id, student: F.vol2._id, type: "missing_hours", event: ev._id, explanation: "SYNTHETIC complaint", deadline: new Date(Date.now() + 86400000) });
  const flags = (await call("GET", `/api/ops/diary/flags?ids=${a._id},${b._id}`, F.t.teacher)).data.flags;
  assert.deepEqual(flags[a._id], []);
  assert.deepEqual(flags[b._id], ["open complaint on this activity"]);
  const r = await call("POST", "/api/ops/diary/bulk-approve", F.t.teacher, { items: [{ id: a._id, rev: a.rev }, { id: b._id, rev: b.rev }] });
  assert.deepEqual(r.data.results.map((x) => x.state), ["approved", "skipped"]);
  assert.equal(await LedgerEntry.countDocuments({ event: ev._id }), 1);
  const log = await AuditLog.findOne({ action: "diary.approve", targetId: a._id }).lean();
  assert.equal(log.details.bulk, true, "each bulk decision has its own audit record");
  assert.equal((await call("POST", "/api/ops/diary/bulk-approve", F.t.otherTeacher, { items: [{ id: b._id }] })).data.results[0].state, "skipped", "flags checked before assignment; still not approved");
});

test("workspace filters and operational queues", async () => {
  let w = (await call("GET", "/api/ops/workspace", F.t.po)).data;
  assert.equal(w.submitted.total, 1);
  assert.equal(w.permissionsPending[0].pending[0], "Panchayat letter");
  assert.equal(w.filters.units.length, 1);
  assert.deepEqual(w.filters.batches, ["B1"]);
  w = (await call("GET", `/api/ops/workspace?unit=${unit._id}&batch=B1`, F.t.po)).data;
  assert.equal(w.submitted.total, 0, "vol2's pending entry is outside the unit filter");
  assert.deepEqual(w.belowTarget.items.map((v) => String(v._id)), [String(F.vol._id)]);

  const d = (await call("POST", "/api/ops/deadlines", F.t.po, { title: "University monthly report", reportType: "periodic", dueDate: "2025-01-05", periodFrom: "2024-12-01", periodTo: "2025-01-01" })).data.deadline;
  w = (await call("GET", "/api/ops/workspace", F.t.po)).data;
  assert.equal(w.deadlines[0].overdue, true);
  const rep = (await call("POST", "/api/ops/reports", F.t.po, { type: "periodic", from: "2024-12-01", to: "2025-01-01" })).data.report;
  await call("POST", `/api/ops/reports/${rep._id}/approve`, F.t.po2);
  w = (await call("GET", "/api/ops/workspace", F.t.po)).data;
  assert.equal(w.deadlines[0].met, true);
  assert.equal((await call("POST", `/api/ops/deadlines/${d._id}/done`, F.t.poB)).status, 404);
});
