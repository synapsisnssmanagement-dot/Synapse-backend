import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { client, startEnv, tokenFor } from "./harness.js";
import { TAG, baseFixtures, person } from "./fixtures.js";
import DiaryEntry from "../models/DiaryEntry.js";
import Event from "../models/Event.js";
import LedgerEntry from "../models/LedgerEntry.js";
import Student from "../models/Student.js";
import Teacher from "../models/Teacher.js";

let env, call, F, ev;

before(async () => {
  env = await startEnv();
  call = client(env.base);
  F = await baseFixtures();
  F.pendingVol = await person(Student, F.instA, { role: "volunteer", talents: ["x"], status: "pending" });
  F.plainStudent = await person(Student, F.instA, { role: "student", talents: ["x"] });
  F.pendingTeacher = await person(Teacher, F.instA, { status: "pending" });
  F.t.pendingVol = tokenFor(F.pendingVol, "volunteer");
  F.t.plainStudent = tokenFor(F.plainStudent, "student");
  F.t.pendingTeacher = tokenFor(F.pendingTeacher, "teacher");
  ev = await Event.create({ title: `${TAG} E`, description: "x", date: new Date("2025-08-10"), location: "x", institution: F.instA._id, calculatedHours: 2, status: "Completed", participants: [F.vol._id], assignedTeacher: [F.pendingTeacher._id, F.teacher._id], attendance: [{ student: F.vol._id, status: "Present" }, { student: F.pendingVol._id, status: "Present" }] });
});
after(() => env?.stop());

test("unauthenticated, inactive and non-volunteer accounts are refused", async () => {
  assert.equal((await call("GET", "/api/ops/passbook/me")).status, 401);
  assert.equal((await call("GET", "/api/ops/passbook/me", "garbage")).status, 401);
  assert.equal((await call("POST", "/api/ops/diary", F.t.pendingVol, { event: ev._id, serviceDate: "2025-08-10", claimedMinutes: 60, workDone: "x" })).status, 403);
  assert.equal((await call("POST", "/api/ops/diary", F.t.plainStudent, { event: ev._id, serviceDate: "2025-08-10", claimedMinutes: 60, workDone: "x" })).status, 403);
  assert.equal((await call("GET", "/api/ops/units", F.t.pendingVol)).status, 403);
  const d = (await call("POST", "/api/ops/diary", F.t.vol, { event: ev._id, serviceDate: "2025-08-10", claimedMinutes: 60, workDone: "x" })).data.entry;
  await call("POST", `/api/ops/diary/${d._id}/submit`, F.t.vol);
  assert.equal((await call("POST", `/api/ops/diary/${d._id}/decide`, F.t.pendingTeacher, { action: "approve" })).status, 403, "assigned but inactive supervisor");
});

test("mass assignment and ownership", async () => {
  const d = (await call("POST", "/api/ops/diary", F.t.vol, { event: ev._id, serviceDate: "2025-08-10", claimedMinutes: 30, workDone: "x", status: "approved", student: F.vol2._id, institution: F.instB._id, ledgerEntry: "507f1f77bcf86cd799439011", decisions: [{ action: "approve" }] })).data.entry;
  const stored = await DiaryEntry.findById(d._id).lean();
  assert.equal(stored.status, "draft");
  assert.equal(String(stored.student), String(F.vol._id));
  assert.equal(String(stored.institution), String(F.instA._id));
  assert.equal(stored.decisions.length, 0);
  assert.equal((await call("PATCH", `/api/ops/diary/${d._id}`, F.t.vol2, { workDone: "hijack" })).status, 404, "another volunteer cannot edit");
  assert.equal((await call("PATCH", `/api/ops/diary/${d._id}`, F.t.volB, { workDone: "hijack" })).status, 404);
});

test("input validation: ids, dates, durations, URLs, operator injection", async () => {
  assert.equal((await call("GET", "/api/ops/passbook/not-an-id", F.t.po)).status, 400);
  assert.equal((await call("POST", "/api/ops/diary", F.t.vol, { event: ev._id, serviceDate: "not-a-date", claimedMinutes: 30, workDone: "x" })).status, 400);
  for (const m of [0, -5, 1441, 12.5, "abc"]) assert.equal((await call("POST", "/api/ops/diary", F.t.vol, { event: ev._id, serviceDate: "2025-08-10", claimedMinutes: m, workDone: "x" })).status, 400, `minutes ${m}`);
  assert.equal((await call("POST", "/api/ops/diary", F.t.vol, { event: ev._id, serviceDate: "2025-08-10", claimedMinutes: 30, workDone: "x", evidence: [{ label: "x", url: "javascript:alert(1)" }] })).status, 400);
  assert.equal((await call("POST", "/api/ops/diary", F.t.vol, { event: ev._id, serviceDate: "2030-01-01", claimedMinutes: 30, workDone: "x" })).status, 400, "future date");
  // Operator objects in query parameters must not widen a query.
  const r = await call("GET", `/api/ops/diary/review?status[$ne]=x`, F.t.po);
  assert.ok(r.status === 400 || r.data.entries.every((e) => e.status === "submitted"), "operator ignored; only the default status is returned");
  assert.equal((await call("POST", "/api/ops/ledger/507f1f77bcf86cd799439011/adjust", F.t.po, { minutes: { $gt: 0 }, reason: "x x x", opId: "op-abcdefgh" })).status, 404);
});

test("errors are safe; no stack traces or internals", async () => {
  const r = await call("POST", "/api/ops/policies", F.t.po, { requirementType: "national", name: "x", effectiveFrom: "2025-01-01", changeReason: "x x x", rules: { academicYearStartMonth: 13 } });
  assert.equal(r.status, 400);
  assert.ok(!/at |\.js:|Mongo|stack/i.test(JSON.stringify(r.data)));
  assert.equal(await LedgerEntry.countDocuments(), 0);
});
