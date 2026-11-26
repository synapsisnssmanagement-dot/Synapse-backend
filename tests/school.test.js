import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { client, startEnv } from "./harness.js";
import { TAG, activePolicy, baseFixtures } from "./fixtures.js";
import Enrolment from "../models/Enrolment.js";
import Event from "../models/Event.js";
import LedgerEntry from "../models/LedgerEntry.js";
import Message from "../models/Message.js";
import NssUnit from "../models/NssUnit.js";

let env, call, F, unit;

before(async () => {
  env = await startEnv();
  call = client(env.base);
  F = await baseFixtures();
  await activePolicy(F.instA, F.po);
  unit = await NssUnit.create({ institution: F.instA._id, name: "School unit", code: "SCH", level: "higher_secondary" });
});
after(() => env?.stop());

test("higher-secondary unit accepts XI/XII and community service, not UG", async () => {
  assert.equal((await call("POST", "/api/ops/enrolments", F.t.po, { unit: unit._id, student: F.vol._id, academicYear: 2025, level: "UG" })).status, 400);
  const r = await call("POST", "/api/ops/enrolments", F.t.po, { unit: unit._id, student: F.vol._id, academicYear: 2025, level: "XI" });
  assert.equal(r.status, 201);
  assert.equal(r.data.enrolment.guardianPermission.required, true);
  assert.equal((await call("POST", "/api/ops/enrolments", F.t.po, { unit: unit._id, student: F.vol2._id, academicYear: 2025, level: "community_service" })).status, 201);
});

test("lower-school community service is recorded but never counts as NSS service", async () => {
  const ev = await Event.create({ title: `${TAG} Cleanliness`, description: "x", date: new Date("2025-08-20T04:00:00Z"), location: "x", institution: F.instA._id, calculatedHours: 2, status: "Completed", participants: [F.vol._id, F.vol2._id], attendance: [{ student: F.vol._id, status: "Present" }, { student: F.vol2._id, status: "Present" }] });
  for (const t of [F.t.vol, F.t.vol2]) {
    const d = (await call("POST", "/api/ops/diary", t, { event: ev._id, serviceDate: "2025-08-20", claimedMinutes: 120, workDone: "Cleaning" })).data.entry;
    await call("POST", `/api/ops/diary/${d._id}/submit`, t);
    assert.equal((await call("POST", `/api/ops/diary/${d._id}/decide`, F.t.po, { action: "approve" })).status, 200);
  }
  assert.equal((await LedgerEntry.findOne({ student: F.vol2._id }).lean()).programme, "community_service");
  assert.equal((await LedgerEntry.findOne({ student: F.vol._id }).lean()).programme, "nss");
  const cs = (await call("GET", "/api/ops/passbook/me", F.t.vol2)).data.summary;
  assert.equal(cs.verifiedRegularMinutes, 0);
  assert.equal(cs.communityServiceMinutes, 120);
  const pub = (await call("GET", `/api/nss/public/impact/${F.instA._id}`)).data;
  assert.equal(pub.summary.hours, 2, "public NSS hours exclude community service");
});

test("leaderboard hides Class XI/XII volunteers by default; first-name-only when configured", async () => {
  let lb = (await call("GET", "/api/students/leaderboard", F.t.vol2)).data.leaderboard;
  assert.ok(!lb.some((s) => String(s._id) === String(F.vol._id)), "XI volunteer hidden from others");
  lb = (await call("GET", "/api/students/leaderboard", F.t.vol)).data.leaderboard;
  assert.ok(lb.some((s) => String(s._id) === String(F.vol._id)), "but sees themself");
  assert.equal((await call("PUT", "/api/ops/settings", F.t.po, { privacy: { minorsPublicProfile: "first_name_only" } })).status, 400, "reason required");
  await call("PUT", "/api/ops/settings", F.t.po, { privacy: { minorsPublicProfile: "first_name_only" }, reason: "Parents' committee decision" });
  lb = (await call("GET", "/api/students/leaderboard", F.t.po)).data.leaderboard;
  const me = lb.find((s) => String(s._id) === String(F.vol._id));
  assert.equal(me.name, F.vol.name.split(" ")[0]);
  assert.equal(me.department, "");
});

test("school approval chain: settings validated, named Principal step enforced", async () => {
  assert.equal((await call("PUT", "/api/ops/settings", F.t.po, { approvalChains: { project: [{ name: "PO" }, { name: "Principal", approvers: [F.poB._id] }] }, reason: "x x x" })).status, 400, "approver from another institution");
  assert.equal((await call("PUT", "/api/ops/settings", F.t.teacher, { kind: "higher_secondary_school", reason: "x x x" })).status, 403);
  await call("PUT", "/api/ops/settings", F.t.po, { kind: "higher_secondary_school", approvalChains: { project: [{ name: "Programme Officer" }, { name: "Principal", approvers: [F.teacher._id] }] }, reason: "School approval chain" });
  const p = (await call("POST", "/api/ops/projects", F.t.po, { kind: "standalone", title: `${TAG} School drive`, schedule: { startDate: "2026-02-01" } })).data.project;
  const t = (tok) => call("POST", `/api/ops/projects/${p._id}/transition`, tok, { action: "approve" });
  await call("POST", `/api/ops/projects/${p._id}/transition`, F.t.po, { action: "submit" });
  assert.equal((await t(F.t.teacher)).status, 403, "Principal can't sign before the PO step");
  assert.equal((await t(F.t.po)).data.project.status, "submitted");
  assert.equal((await t(F.t.po2)).status, 403, "other officer is not the named Principal");
  assert.equal((await t(F.t.teacher)).data.project.status, "approved");
});

test("event chat is no longer readable without login or across institutions", async () => {
  const ev = await Event.create({ title: `${TAG} Chat`, description: "x", date: new Date(), location: "x", institution: F.instA._id });
  await Message.create({ eventId: ev._id, institutionId: F.instA._id, sender: { id: F.vol._id, name: F.vol.name, role: "volunteer" }, content: "SYNTHETIC hello" });
  assert.equal((await call("GET", `/api/chat/events/${ev._id}/messages`)).status, 401);
  assert.equal((await call("GET", `/api/chat/events/${ev._id}/messages`, F.t.volB)).status, 404);
  assert.equal((await call("GET", `/api/chat/events/${ev._id}/messages`, F.t.vol2)).data.messages.length, 1);
});
