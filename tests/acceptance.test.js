// FINAL END-TO-END ACCEPTANCE SCENARIO (isolated, synthetic data).
// One continuous flow through the API, numbered as in the brief.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { client, startEnv } from "./harness.js";
import { TAG, baseFixtures } from "./fixtures.js";
import Event from "../models/Event.js";
import LedgerEntry from "../models/LedgerEntry.js";

let env, call, F;
const S = {};
const day = (d) => new Date(Date.UTC(2025, 7, d, 4)).toISOString();

before(async () => {
  env = await startEnv();
  call = client(env.base);
  F = await baseFixtures();
});
after(() => env?.stop());

test("acceptance scenario 1–17", async (t) => {
  const po = (m, u, b) => call(m, u, F.t.po, b);

  await t.test("1. configure institution unit, academic year and policy", async () => {
    S.unit = (await po("POST", "/api/ops/units", { name: `${TAG} Unit`, code: "ACC-1" })).data.unit;
    const tpl = (await po("GET", "/api/ops/policies/template")).data.template;
    // Two consecutive years at 1 h each for a compact scenario; 7-day camp.
    const p = (await po("POST", "/api/ops/policies", { ...tpl, name: `${TAG} acceptance policy`, sourceReference: "SYNTHETIC reference", effectiveFrom: "2020-06-01", changeReason: "Acceptance test", rules: { ...tpl.rules, regularMinutesPerYear: 60, yearsRequired: 2, reportSignatories: ["Programme Officer", "Principal"] } })).data.policy;
    assert.equal((await po("POST", `/api/ops/policies/${p._id}/activate`, { reason: "Reviewed (synthetic)", verifiedByInstitution: true })).data.policy.status, "active");
    S.policy = p;
  });

  await t.test("2. enrol a volunteer", async () => {
    for (const y of [2024, 2025]) assert.equal((await po("POST", "/api/ops/enrolments", { unit: S.unit._id, student: F.vol._id, academicYear: y, batch: "2024-26" })).status, 201);
  });

  await t.test("3. create and approve a community activity", async () => {
    const p = (await po("POST", "/api/ops/projects", { kind: "standalone", title: `${TAG} Village survey`, schedule: { startDate: day(10).slice(0, 10), startTime: "09:30", sessionHours: 3 }, responsibleStaff: [F.teacher._id], volunteerTeams: [{ name: "Survey", members: [F.vol._id] }], plannedOutcomes: [{ metric: "Households surveyed", unit: "households", target: 40 }] })).data.project;
    await po("POST", `/api/ops/projects/${p._id}/transition`, { action: "submit" });
    assert.equal((await po("POST", `/api/ops/projects/${p._id}/transition`, { action: "approve" })).data.project.status, "approved");
    S.project = p;
  });

  await t.test("4. assign staff and volunteers (scheduling creates the session)", async () => {
    const r = await po("POST", `/api/ops/projects/${S.project._id}/transition`, { action: "schedule" });
    assert.equal(r.data.sessions.created, 1);
    S.event = await Event.findOne({ project: S.project._id }).lean();
    assert.deepEqual(S.event.assignedTeacher.map(String), [String(F.teacher._id)]);
    assert.deepEqual(S.event.participants.map(String), [String(F.vol._id)]);
    await Event.updateOne({ _id: S.event._id }, { $set: { status: "Completed" } });
  });

  await t.test("5. record participation (partial, via supervisor)", async () => {
    const r = await call("POST", "/api/ops/attendance/sync", F.t.teacher, { ops: [{ opId: "op-acceptance-0001", event: S.event._id, student: F.vol._id, sessionDate: S.event.sessionKey, status: "partial", checkInAt: day(10), checkOutAt: new Date(Date.parse(day(10)) + 150 * 60000).toISOString() }] });
    assert.equal(r.data.results[0].state, "synced");
  });

  await t.test("6. submit a volunteer diary", async () => {
    S.diary = (await call("POST", "/api/ops/diary", F.t.vol, { event: S.event._id, serviceDate: S.event.sessionKey, claimedMinutes: 150, workDone: "Surveyed 18 households" })).data.entry;
    assert.equal((await call("POST", `/api/ops/diary/${S.diary._id}/submit`, F.t.vol)).data.entry.status, "submitted");
  });

  await t.test("7. return it with feedback", async () => {
    assert.equal((await call("POST", `/api/ops/diary/${S.diary._id}/decide`, F.t.teacher, { action: "return", reason: "Add your reflection" })).data.entry.status, "returned");
  });

  await t.test("8. correct and resubmit it", async () => {
    await call("PATCH", `/api/ops/diary/${S.diary._id}`, F.t.vol, { reflection: "Learned to ask open questions" });
    assert.equal((await call("POST", `/api/ops/diary/${S.diary._id}/submit`, F.t.vol)).data.entry.revisions.length, 2);
  });

  await t.test("9. approve a justified duration", async () => {
    const r = await call("POST", `/api/ops/diary/${S.diary._id}/decide`, F.t.teacher, { action: "approve", approvedMinutes: 140, reason: "10-minute break excluded" });
    assert.equal(r.data.entry.status, "approved");
  });

  await t.test("10. exactly one ledger credit", async () => {
    const rows = await LedgerEntry.find({ student: F.vol._id }).lean();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].minutes, 140);
    assert.equal(rows[0].policyVersion, S.policy.version);
    S.credit = rows[0];
  });

  await t.test("11. officer and volunteer totals agree", async () => {
    const v = (await call("GET", "/api/ops/passbook/me", F.t.vol)).data.summary;
    const o = (await po("GET", `/api/ops/passbook/${F.vol._id}`)).data.summary;
    assert.deepEqual(v, o);
    const e = (await po("GET", "/api/nss/eligibility")).data.volunteers.find((x) => String(x._id) === String(F.vol._id));
    assert.equal(e.total, Math.round((140 / 60) * 100) / 100, "eligibility screen uses the same ledger total");
  });

  await t.test("12. raise and resolve an hours complaint with recorded history", async () => {
    const g = (await call("POST", "/api/ops/grievances", F.t.vol, { type: "incorrect_duration", ledgerEntry: S.credit._id, explanation: "The break was 5 minutes, not 10." })).data.grievance;
    await po("POST", `/api/ops/grievances/${g._id}/respond`, { action: "review", note: "Checking register" });
    const r = await po("POST", `/api/ops/grievances/${g._id}/respond`, { action: "uphold", note: "Register shows a 5-minute break", minutesAdjustment: 5 });
    assert.equal(r.data.grievance.status, "upheld");
    assert.equal(r.data.grievance.history.length, 3);
    assert.equal((await call("GET", "/api/ops/passbook/me", F.t.vol)).data.summary.verifiedRegularMinutes, 145);
    // Previous academic year service for the two-year rule (synthetic, verified via a second activity).
    const ev2 = await Event.create({ title: `${TAG} 2024 drive`, description: "x", date: new Date("2024-09-01T04:00:00Z"), location: "x", institution: F.instA._id, calculatedHours: 2, status: "Completed", assignedTeacher: [F.teacher._id], participants: [F.vol._id], attendance: [{ student: F.vol._id, status: "Present" }] });
    const d = (await call("POST", "/api/ops/diary", F.t.vol, { event: ev2._id, serviceDate: "2024-09-01", claimedMinutes: 120, workDone: "Drive" })).data.entry;
    await call("POST", `/api/ops/diary/${d._id}/submit`, F.t.vol);
    await call("POST", `/api/ops/diary/${d._id}/decide`, F.t.teacher, { action: "approve" });
  });

  await t.test("13. complete a camp with daily evidence", async () => {
    const days = Array.from({ length: 7 }, (_, i) => new Date(Date.UTC(2025, 11, 1 + i, 6)));
    const c = (await po("POST", "/api/ops/camps", { title: `${TAG} Camp`, startDate: days[0], endDate: days[6], capacity: 5, supervisors: [F.teacher._id] })).data.camp;
    await po("POST", `/api/ops/camps/${c._id}/transition`, { action: "submit" });
    const ap = (await po("POST", `/api/ops/camps/${c._id}/transition`, { action: "approve" })).data.camp;
    await call("POST", `/api/ops/camps/${c._id}/apply`, F.t.vol);
    await po("POST", `/api/ops/camps/${c._id}/applications`, { student: F.vol._id, action: "select" });
    await po("POST", `/api/ops/camps/${c._id}/applications`, { student: F.vol._id, action: "confirm" });
    await po("POST", `/api/ops/camps/${c._id}/transition`, { action: "start" });
    const ops = days.map((d, i) => ({ opId: `op-acc-camp-${i}aaaa`, event: ap.event, student: F.vol._id, sessionDate: d.toISOString().slice(0, 10), status: "present", minutes: 360 }));
    assert.ok((await call("POST", "/api/ops/attendance/sync", F.t.teacher, { ops })).data.results.every((r) => r.state === "synced"));
    for (const d of days) {
      const e = (await call("POST", "/api/ops/diary", F.t.vol, { event: ap.event, serviceDate: d, claimedMinutes: 360, workDone: "Camp work" })).data.entry;
      assert.equal((await call("POST", `/api/ops/diary/${e._id}/submit`, F.t.vol)).status, 200);
      assert.equal((await call("POST", `/api/ops/diary/${e._id}/decide`, F.t.teacher, { action: "approve" })).status, 200);
    }
    await po("POST", `/api/ops/camps/${c._id}/transition`, { action: "complete" });
    const review = (await po("GET", `/api/ops/camps/${c._id}/completion`)).data.rows[0];
    assert.equal(review.daysCredited, 7);
    assert.deepEqual(review.missingDays, []);
    assert.equal((await po("POST", `/api/ops/camps/${c._id}/completion`, { student: F.vol._id, decision: "complete" })).status, 200);
    await call("POST", `/api/ops/camps/${c._id}/closing-report`, F.t.teacher, { summary: "Seven-day camp completed (synthetic)." });
    assert.equal((await po("POST", `/api/ops/camps/${c._id}/closing-report`, { action: "review" })).data.camp.status, "reviewed");
  });

  await t.test("14. generate a report matching approved records", async () => {
    const r = (await po("POST", "/api/ops/reports", { type: "service_summary", from: "2024-06-01", to: "2026-06-01" })).data.report;
    const pb = (await call("GET", "/api/ops/passbook/me", F.t.vol)).data.summary;
    assert.equal(r.data.totals.verifiedRegularMinutes, pb.verifiedRegularMinutes);
    assert.equal(r.data.totals.verifiedCampMinutes, pb.verifiedCampMinutes);
    assert.equal((await call("POST", `/api/ops/reports/${r._id}/approve`, F.t.po2)).data.report.status, "approved");
  });

  await t.test("15. review and issue the appropriate certificate", async () => {
    const prev = (await po("GET", `/api/ops/certificates/preview?student=${F.vol._id}&policy=${S.policy._id}`)).data;
    assert.equal(prev.evaluation.met, true, JSON.stringify(prev.evaluation));
    S.cert = (await po("POST", "/api/ops/certificates", { student: F.vol._id, policy: S.policy._id })).data.certificate;
    assert.equal((await call("POST", `/api/ops/certificates/${S.cert._id}/review`, F.t.po2, { action: "issue" })).data.certificate.status, "issued");
  });

  await t.test("16. verify and revoke it (test environment)", async () => {
    assert.equal((await call("GET", `/api/public/verify/${S.cert.certId}`)).data.valid, true);
    await po("POST", `/api/ops/certificates/${S.cert._id}/revoke`, { reason: "Acceptance test revocation" });
    const v = (await call("GET", `/api/public/verify/${S.cert.certId}`)).data;
    assert.equal(v.valid, false);
    assert.equal(v.certificate.status, "revoked");
  });

  await t.test("17. a different institution cannot access the records", async () => {
    const B = F.t.poB;
    for (const [m, u] of [
      ["GET", `/api/ops/passbook/${F.vol._id}`],
      ["GET", `/api/ops/projects/${S.project._id}`],
      ["POST", `/api/ops/diary/${S.diary._id}/decide`],
      ["POST", `/api/ops/certificates/${S.cert._id}/reissue`],
      ["POST", `/api/ops/ledger/${S.credit._id}/adjust`],
    ]) assert.equal((await call(m, u, B, m === "GET" ? undefined : { action: "approve", reason: "x x x", minutes: 1, opId: "op-xinstxxxx" })).status, 404, `${m} ${u}`);
    assert.equal((await call("GET", "/api/ops/diary/review?status=approved", B)).data.total, 0);
    assert.equal((await call("GET", "/api/ops/certificates", B)).data.certificates.length, 0);
    assert.equal((await call("GET", "/api/ops/reports", B)).data.reports.length, 0);
  });
});
