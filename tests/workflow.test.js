import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { client, startEnv, tokenFor } from "./harness.js";
import Coordinator from "../models/Coordinator.js";
import Event from "../models/Event.js";
import Institution from "../models/Institution.js";
import LedgerEntry from "../models/LedgerEntry.js";
import Student from "../models/Student.js";
import Teacher from "../models/Teacher.js";

let env, call;
const F = {}; // fixtures
const tag = "SYNTHETIC TEST";

const person = (Model, inst, extra = {}) =>
  Model.create({ name: `${tag} ${Model.modelName} ${Math.random().toString(36).slice(2, 7)}`, email: `${Math.random().toString(36).slice(2)}@example.test`, phoneNumber: "0000000000", department: "Test", password: "x", institution: inst._id, status: "active", ...extra });

before(async () => {
  env = await startEnv();
  call = client(env.base);
  F.instA = await Institution.create({ name: `${tag} College A` });
  F.instB = await Institution.create({ name: `${tag} College B` });
  F.po = await person(Coordinator, F.instA);
  F.poB = await person(Coordinator, F.instB);
  F.inactivePo = await person(Coordinator, F.instA, { status: "pending" });
  F.teacher = await person(Teacher, F.instA);
  F.otherTeacher = await person(Teacher, F.instA);
  F.vol = await person(Student, F.instA, { role: "volunteer", talents: ["x"] });
  F.vol2 = await person(Student, F.instA, { role: "volunteer", talents: ["x"] });
  F.volB = await person(Student, F.instB, { role: "volunteer", talents: ["x"] });
  F.t = {
    po: tokenFor(F.po, "coordinator"),
    poB: tokenFor(F.poB, "coordinator"),
    inactivePo: tokenFor(F.inactivePo, "coordinator"),
    teacher: tokenFor(F.teacher, "teacher"),
    otherTeacher: tokenFor(F.otherTeacher, "teacher"),
    vol: tokenFor(F.vol, "volunteer"),
    vol2: tokenFor(F.vol2, "volunteer"),
    volB: tokenFor(F.volB, "volunteer"),
  };
});
after(() => env?.stop());

test("1. configure unit, policy (draft → active) and enrol a volunteer", async () => {
  let r = await call("POST", "/api/ops/units", F.t.po, { name: "Unit 1", code: "u-1" });
  assert.equal(r.status, 201);
  F.unit = r.data.unit;
  assert.equal(F.unit.code, "U-1");
  r = await call("POST", "/api/ops/units", F.t.po, { name: "dup", code: "U-1" });
  assert.equal(r.status, 409);

  r = await call("POST", "/api/ops/units", F.t.inactivePo, { name: "x", code: "x" });
  assert.equal(r.status, 403, "inactive officer cannot act");

  const tpl = (await call("GET", "/api/ops/policies/template", F.t.po)).data.template;
  assert.match(tpl.name, /DRAFT/);
  r = await call("POST", "/api/ops/policies", F.t.po, { ...tpl, effectiveFrom: "2020-06-01", changeReason: "Initial test policy" });
  assert.equal(r.status, 201);
  F.policy1 = r.data.policy;
  assert.equal(F.policy1.version, 1);
  assert.equal(F.policy1.status, "draft");

  r = await call("POST", `/api/ops/policies/${F.policy1._id}/activate`, F.t.po, { reason: "ok" });
  assert.equal(r.status, 400, "national policy needs a source reference");
  r = await call("POST", "/api/ops/policies", F.t.po, { ...tpl, sourceReference: "SYNTHETIC test document ref", effectiveFrom: "2020-06-01", changeReason: "Add source" });
  F.policy2 = r.data.policy;
  assert.equal(F.policy2.version, 2);
  r = await call("POST", `/api/ops/policies/${F.policy2._id}/activate`, F.t.po, { reason: "Reviewed in test" });
  assert.equal(r.status, 200);
  assert.equal(r.data.policy.status, "active");

  r = await call("POST", "/api/ops/enrolments", F.t.po, { unit: F.unit._id, student: F.vol._id, academicYear: 2025, batch: "2025-27" });
  assert.equal(r.status, 201);
  r = await call("POST", "/api/ops/enrolments", F.t.po, { unit: F.unit._id, student: F.vol._id, academicYear: 2025 });
  assert.equal(r.status, 409, "duplicate enrolment rejected");
  r = await call("POST", "/api/ops/enrolments", F.t.po, { unit: F.unit._id, student: F.volB._id, academicYear: 2025 });
  assert.equal(r.status, 404, "cannot enrol another institution's student");
});

test("2. activity with attendance; diary draft → submit → return → resubmit → approve; exactly one credit", async () => {
  F.event = await Event.create({
    title: `${tag} Village survey`, description: "x", date: new Date("2025-08-10T04:00:00Z"), location: "x", institution: F.instA._id,
    hours: 4, calculatedHours: 3, status: "Completed", assignedTeacher: [F.teacher._id], participants: [F.vol._id, F.vol2._id],
    attendance: [{ student: F.vol._id, status: "Present" }, { student: F.vol2._id, status: "Absent" }],
  });
  let r = await call("POST", "/api/ops/diary", F.t.vol, { event: F.event._id, serviceDate: "2025-08-10T09:00:00Z", claimedMinutes: 240, workDone: "Household survey" });
  assert.equal(r.status, 201);
  const id = r.data.entry._id;

  r = await call("POST", `/api/ops/diary/${id}/submit`, F.t.vol);
  assert.equal(r.status, 400, "claim above the recorded 180-minute session is refused");
  await call("PATCH", `/api/ops/diary/${id}`, F.t.vol, { claimedMinutes: 180, status: "approved" /* ignored: not whitelisted */ });
  r = await call("POST", `/api/ops/diary/${id}/submit`, F.t.vol);
  assert.equal(r.status, 200);
  assert.equal(r.data.entry.status, "submitted");

  // Absent volunteer cannot claim.
  const d2 = (await call("POST", "/api/ops/diary", F.t.vol2, { event: F.event._id, serviceDate: "2025-08-10", claimedMinutes: 60, workDone: "x" })).data.entry;
  assert.equal((await call("POST", `/api/ops/diary/${d2._id}/submit`, F.t.vol2)).status, 400);

  // Cross-institution and unassigned supervisor are refused.
  assert.equal((await call("POST", `/api/ops/diary/${id}/decide`, F.t.poB, { action: "approve" })).status, 404);
  assert.equal((await call("POST", `/api/ops/diary/${id}/decide`, F.t.otherTeacher, { action: "approve" })).status, 403);
  assert.equal((await call("GET", `/api/ops/passbook/${F.vol._id}`, F.t.poB)).status, 404);

  // Return requires a reason.
  assert.equal((await call("POST", `/api/ops/diary/${id}/decide`, F.t.teacher, { action: "return" })).status, 400);
  r = await call("POST", `/api/ops/diary/${id}/decide`, F.t.teacher, { action: "return", reason: "Add what you learned" });
  assert.equal(r.data.entry.status, "returned");

  await call("PATCH", `/api/ops/diary/${id}`, F.t.vol, { reflection: "Learned how to run a survey" });
  r = await call("POST", `/api/ops/diary/${id}/submit`, F.t.vol);
  assert.equal(r.data.entry.revisions.length, 2);

  // Reduced duration needs a reason.
  assert.equal((await call("POST", `/api/ops/diary/${id}/decide`, F.t.teacher, { action: "approve", approvedMinutes: 150 })).status, 400);

  // Concurrent approvals: exactly one wins.
  const results = await Promise.all([
    call("POST", `/api/ops/diary/${id}/decide`, F.t.teacher, { action: "approve", approvedMinutes: 150, reason: "Left 30 min early per roll" }),
    call("POST", `/api/ops/diary/${id}/decide`, F.t.po, { action: "approve", approvedMinutes: 150, reason: "Left 30 min early per roll" }),
    call("POST", `/api/ops/diary/${id}/decide`, F.t.teacher, { action: "approve", approvedMinutes: 150, reason: "Left 30 min early per roll" }),
  ]);
  assert.equal(results.filter((x) => x.status === 200).length, 1);
  assert.ok(results.filter((x) => x.status !== 200).every((x) => x.status === 409));

  const credits = await LedgerEntry.find({ student: F.vol._id }).lean();
  assert.equal(credits.length, 1);
  assert.equal(credits[0].minutes, 150);
  assert.equal(credits[0].policyVersion, 2, "policy version preserved on the credit");
  F.credit = credits[0];

  // Approved entries cannot be edited.
  assert.equal((await call("PATCH", `/api/ops/diary/${id}`, F.t.vol, { claimedMinutes: 999 })).status, 409);

  // A second diary for the same activity and day cannot create a second credit.
  const dup = (await call("POST", "/api/ops/diary", F.t.vol, { event: F.event._id, serviceDate: "2025-08-10T12:00:00Z", claimedMinutes: 60, workDone: "again" })).data.entry;
  await call("POST", `/api/ops/diary/${dup._id}/submit`, F.t.vol);
  r = await call("POST", `/api/ops/diary/${dup._id}/decide`, F.t.po, { action: "approve" });
  assert.equal(r.status, 409);
  assert.equal(await LedgerEntry.countDocuments({ student: F.vol._id }), 1);
  await call("POST", `/api/ops/diary/${dup._id}/decide`, F.t.po, { action: "reject", reason: "Duplicate of approved entry" });
});

test("3. officer and volunteer totals agree; pending is separate from verified", async () => {
  const mine = (await call("GET", "/api/ops/passbook/me", F.t.vol)).data;
  const officer = (await call("GET", `/api/ops/passbook/${F.vol._id}`, F.t.po)).data;
  assert.equal(mine.summary.verifiedRegularMinutes, 150);
  assert.deepEqual(mine.summary, officer.summary);
  assert.equal(mine.summary.pendingMinutes, 0);
  assert.equal(mine.evaluations[0].result.met, false);
});

test("4. policy change does not rewrite history", async () => {
  const tpl = (await call("GET", "/api/ops/policies/template", F.t.po)).data.template;
  const p3 = (await call("POST", "/api/ops/policies", F.t.po, { ...tpl, sourceReference: "SYNTHETIC v3", effectiveFrom: "2026-06-01", changeReason: "Raise target" })).data.policy;
  await call("POST", `/api/ops/policies/${p3._id}/activate`, F.t.po, { reason: "test" });
  const c = await LedgerEntry.findById(F.credit._id).lean();
  assert.equal(c.policyVersion, 2);
});

test("5. corrections: idempotent adjustment, reversal, no negative totals", async () => {
  const body = { minutes: 15, reason: "Roll call shows 15 more minutes", opId: "op-abc12345" };
  const a = await call("POST", `/api/ops/ledger/${F.credit._id}/adjust`, F.t.po, body);
  const b = await call("POST", `/api/ops/ledger/${F.credit._id}/adjust`, F.t.po, body);
  assert.equal(a.status, 201);
  assert.equal(b.data.duplicate, true);
  assert.equal((await call("POST", `/api/ops/ledger/${F.credit._id}/adjust`, F.t.teacher, body)).status, 403);
  assert.equal((await call("POST", `/api/ops/ledger/${F.credit._id}/adjust`, F.t.po, { minutes: -500, reason: "too much", opId: "op-neg123456" })).status, 400);
  const pb = (await call("GET", "/api/ops/passbook/me", F.t.vol)).data;
  assert.equal(pb.summary.verifiedRegularMinutes, 165);
});

test("6. hours complaint: raised, reviewed, upheld with a linked ledger adjustment", async () => {
  let r = await call("POST", "/api/ops/grievances", F.t.vol, { type: "incorrect_duration", ledgerEntry: F.credit._id, explanation: "I stayed until the end of the survey." });
  // The credit was approved just now, so the window is open.
  assert.equal(r.status, 201);
  const g = r.data.grievance;
  assert.equal((await call("POST", `/api/ops/grievances/${g._id}/respond`, F.t.poB, { action: "review", note: "x" })).status, 404);
  await call("POST", `/api/ops/grievances/${g._id}/respond`, F.t.po, { action: "review", note: "Checking roll call" });
  r = await call("POST", `/api/ops/grievances/${g._id}/respond`, F.t.po, { action: "uphold", note: "Supervisor confirms", minutesAdjustment: 15 });
  assert.equal(r.status, 200);
  assert.equal(r.data.grievance.status, "upheld");
  assert.ok(r.data.grievance.resolution.adjustment);
  assert.equal(r.data.grievance.history.length, 3);
  assert.equal((await call("POST", `/api/ops/grievances/${g._id}/respond`, F.t.po, { action: "uphold", note: "again", minutesAdjustment: 15 })).status, 409);
  const pb = (await call("GET", "/api/ops/passbook/me", F.t.vol)).data;
  assert.equal(pb.summary.verifiedRegularMinutes, 180);
  const mine = (await call("GET", "/api/ops/grievances/me", F.t.vol)).data.grievances;
  assert.equal(mine[0].status, "upheld");
});

test("7. camp completion needs every required day; missing days are explicit", async () => {
  const days = Array.from({ length: 7 }, (_, i) => new Date(Date.UTC(2025, 11, 1 + i, 6)));
  const camp = await Event.create({
    title: `${tag} Camp`, description: "x", date: days[0], endDate: days[6], location: "x", institution: F.instA._id, type: "special_camp", hours: 6, status: "Completed",
    campDays: days.map((d) => ({ date: d, present: [F.vol._id] })),
  });
  for (const d of days.slice(0, 6)) {
    const e = (await call("POST", "/api/ops/diary", F.t.vol, { event: camp._id, serviceDate: d, claimedMinutes: 360, workDone: "Camp work" })).data.entry;
    assert.equal((await call("POST", `/api/ops/diary/${e._id}/submit`, F.t.vol)).status, 200);
    assert.equal((await call("POST", `/api/ops/diary/${e._id}/decide`, F.t.po, { action: "approve" })).status, 200);
  }
  let pb = (await call("GET", "/api/ops/passbook/me", F.t.vol)).data;
  assert.equal(pb.campProgress[0].daysCredited, 6);
  assert.deepEqual(pb.campProgress[0].missingDays, ["2025-12-07"]);
  const active = pb.evaluations.find((x) => x.policy.version === 3);
  assert.equal(active.result.camp.met, false);
  assert.equal(pb.summary.verifiedRegularMinutes, 180, "camp minutes are not counted as regular service");

  const e = (await call("POST", "/api/ops/diary", F.t.vol, { event: camp._id, serviceDate: days[6], claimedMinutes: 360, workDone: "Closing day" })).data.entry;
  await call("POST", `/api/ops/diary/${e._id}/submit`, F.t.vol);
  await call("POST", `/api/ops/diary/${e._id}/decide`, F.t.po, { action: "approve" });
  pb = (await call("GET", "/api/ops/passbook/me", F.t.vol)).data;
  assert.equal(pb.evaluations.find((x) => x.policy.version === 3).result.camp.met, true);
  assert.equal(pb.summary.verifiedCampMinutes, 7 * 360);
});

test("8. workspace lists real queues; another institution sees none of it", async () => {
  const w = (await call("GET", "/api/ops/workspace", F.t.po)).data;
  assert.equal(w.submitted.total, 0);
  assert.ok(w.belowTarget.items.some((v) => String(v._id) === String(F.vol2._id)));
  const wB = (await call("GET", "/api/ops/workspace", F.t.poB)).data;
  assert.equal(wB.policy, null, "no active policy → no target claimed");
  assert.equal(wB.belowTarget.items.length, 0);
  assert.ok(!JSON.stringify(wB).includes(String(F.vol._id)), "no institution A data leaks");
  assert.equal((await call("GET", "/api/ops/workspace", F.t.vol)).status, 403);
  const qB = (await call("GET", "/api/ops/diary/review?status=approved", F.t.poB)).data;
  assert.equal(qB.total, 0);
  const qT = (await call("GET", "/api/ops/diary/review?status=approved", F.t.otherTeacher)).data;
  assert.equal(qT.total, 0, "unassigned teacher sees no entries");
});
