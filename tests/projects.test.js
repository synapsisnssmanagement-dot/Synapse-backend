import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { client, startEnv } from "./harness.js";
import { TAG, baseFixtures } from "./fixtures.js";
import CommunityRequest from "../models/CommunityRequest.js";
import Event from "../models/Event.js";
import { sessionDates } from "../utils/sessions.js";

let env, call, F, pid, cr;

before(async () => {
  env = await startEnv();
  call = client(env.base);
  F = await baseFixtures();
  cr = await CommunityRequest.create({ institution: F.instA._id, orgName: `${TAG} Panchayat`, contactName: "SYNTHETIC", phone: "0000000000", description: "Need help with library reading for children", location: "Synthetic village", status: "accepted" });
});
after(() => env?.stop());

test("session generation: weekly with weekdays and count; monthly skips short months", () => {
  assert.deepEqual(sessionDates({ startDate: "2025-09-01", recurrence: { freq: "weekly", weekdays: [1, 4], count: 4 } }, "recurring"), ["2025-09-01", "2025-09-04", "2025-09-08", "2025-09-11"]);
  assert.deepEqual(sessionDates({ startDate: "2025-01-31", endDate: "2025-05-31", recurrence: { freq: "monthly" } }, "recurring"), ["2025-01-31", "2025-03-31", "2025-05-31"]);
  assert.deepEqual(sessionDates({ startDate: "2025-01-31", recurrence: { freq: "weekly", count: 9 } }, "standalone"), ["2025-01-31"]);
});

test("create from community request preserves the original request", async () => {
  const before = await CommunityRequest.findById(cr._id).lean();
  let r = await call("POST", "/api/ops/projects", F.t.po, {
    kind: "recurring", title: `${TAG} Reading circle`, communityRequest: cr._id,
    schedule: { startDate: "2025-09-01", startTime: "16:00", sessionHours: 2, recurrence: { freq: "weekly", weekdays: [1], count: 3 } },
    responsibleStaff: [F.teacher._id], volunteerTeams: [{ name: "A", members: [F.vol._id] }],
    requiredPermissions: [{ name: "School headmaster permission", status: "pending" }],
    plannedOutcomes: [{ metric: "Children attending", unit: "children", target: 20 }],
  });
  assert.equal(r.status, 201);
  pid = r.data.project._id;
  assert.equal(r.data.project.community.name, `${TAG} Panchayat`);
  const after = await CommunityRequest.findById(cr._id).lean();
  for (const k of ["orgName", "description", "location", "status", "phone"]) assert.equal(after[k], before[k]);
  assert.equal(String(after.project), pid);
  assert.equal((await call("POST", "/api/ops/projects", F.t.po, { kind: "standalone", title: "dup", communityRequest: cr._id })).status, 409);
  assert.equal((await call("POST", "/api/ops/projects", F.t.teacher, { kind: "standalone", title: "x" })).status, 403);
});

test("lifecycle with approval, permission gate and idempotent scheduling", async () => {
  const t = (action, token = F.t.po, extra = {}) => call("POST", `/api/ops/projects/${pid}/transition`, token, { action, ...extra });
  assert.equal((await t("schedule")).status, 409);
  assert.equal((await t("submit")).status, 200);
  assert.equal((await t("approve", F.t.teacher)).status, 403, "teacher is not an approver by default");
  assert.equal((await t("approve", F.t.poB)).status, 404);
  assert.equal((await t("approve")).data.project.status, "approved");
  assert.equal((await call("PATCH", `/api/ops/projects/${pid}`, F.t.po, { budgetEstimatePaise: 999 })).status, 409, "scope locked after approval");
  let r = await t("schedule");
  assert.equal(r.status, 400);
  assert.match(r.data.message, /headmaster/);
  await call("PATCH", `/api/ops/projects/${pid}`, F.t.po, { requiredPermissions: [{ name: "School headmaster permission", status: "obtained", reference: "SYNTHETIC letter" }] });
  r = await t("schedule");
  assert.equal(r.data.sessions.created, 3);
  const sessions = await Event.find({ project: pid }).lean();
  assert.equal(sessions.length, 3);
  assert.equal(sessions[0].date.toISOString(), "2025-09-01T10:30:00.000Z", "16:00 IST");
  assert.ok(sessions.every((s) => s.participants.length === 1 && s.assignedTeacher.length === 1));
  // Adding an existing date again creates nothing.
  r = await call("POST", `/api/ops/projects/${pid}/sessions`, F.t.teacher, { date: "2025-09-08" });
  assert.equal(r.data.created, 0);
  assert.equal(await Event.countDocuments({ project: pid }), 3);

  assert.equal((await t("start", F.t.teacher)).data.project.status, "in_progress");
  assert.equal((await t("complete", F.t.teacher)).data.project.status, "completed");
  assert.equal((await t("review")).status, 400, "review needs a summary");
  assert.equal((await t("review", F.t.po, { summary: "Ran 3 sessions" })).data.project.status, "reviewed");
  assert.equal((await t("archive")).data.project.status, "archived");
  assert.equal((await t("cancel", F.t.po, { reason: "x" })).status, 409);
});

test("cancellation needs a reason and cancels upcoming sessions", async () => {
  const p = (await call("POST", "/api/ops/projects", F.t.po, { kind: "standalone", title: `${TAG} Drive`, schedule: { startDate: "2026-01-10" } })).data.project;
  const t = (action, extra = {}) => call("POST", `/api/ops/projects/${p._id}/transition`, F.t.po, { action, ...extra });
  await t("submit");
  await t("approve");
  await t("schedule");
  assert.equal(await Event.countDocuments({ project: p._id, status: "Upcoming" }), 1);
  assert.equal((await t("cancel")).status, 400);
  assert.equal((await t("cancel", { reason: "Monsoon flooding" })).data.project.status, "cancelled");
  assert.equal(await Event.countDocuments({ project: p._id, status: "Cancelled" }), 1);
});
