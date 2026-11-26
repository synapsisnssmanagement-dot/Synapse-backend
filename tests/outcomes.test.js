import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { client, startEnv } from "./harness.js";
import { TAG, baseFixtures } from "./fixtures.js";
import Event from "../models/Event.js";
import LedgerEntry from "../models/LedgerEntry.js";
import Project from "../models/Project.js";

let env, call, F, p, session;

before(async () => {
  env = await startEnv();
  call = client(env.base);
  F = await baseFixtures();
  p = await Project.create({ institution: F.instA._id, kind: "standalone", title: `${TAG} Tree planting`, status: "in_progress", responsibleStaff: [F.teacher._id], volunteerTeams: [{ name: "A", members: [F.vol._id] }], plannedOutcomes: [{ metric: "Trees planted", unit: "trees", target: 100 }] });
  session = await Event.create({ title: `${TAG} Planting day`, description: "x", date: new Date("2025-07-01"), location: "x", institution: F.instA._id, status: "Completed", project: p._id, sessionKey: "2025-07-01", impact: [{ metric: "Unverified legacy", value: 999 }] });
});
after(() => env?.stop());

test("planned vs reported vs verified vs follow-up; attendance is not impact", async () => {
  let r = await call("POST", `/api/ops/projects/${p._id}/outcomes`, F.t.vol, { metric: "Trees planted", unit: "trees", value: 80, observedAt: "2025-07-01", event: session._id });
  assert.equal(r.status, 201);
  const o = r.data.outcome;
  assert.equal((await call("POST", `/api/ops/projects/${p._id}/outcomes`, F.t.vol2, { metric: "Trees planted", value: 1 })).status, 403, "not on team");
  assert.equal((await call("POST", `/api/ops/outcomes/${o._id}/verify`, F.t.otherTeacher, { decision: "verified" })).status, 403);
  assert.equal((await call("POST", `/api/ops/outcomes/${o._id}/verify`, F.t.teacher, { decision: "verified", value: 75 })).status, 400, "changed value needs a reason");
  r = await call("POST", `/api/ops/outcomes/${o._id}/verify`, F.t.teacher, { decision: "verified", value: 75, reason: "Counted 75 saplings on site" });
  assert.equal(r.data.outcome.value, 75);
  assert.equal((await call("POST", `/api/ops/outcomes/${o._id}/verify`, F.t.po, { decision: "verified" })).status, 409);

  // Staff-reported follow-up must be verified by someone else.
  r = await call("POST", `/api/ops/projects/${p._id}/outcomes`, F.t.teacher, { metric: "Trees surviving (3-month check)", unit: "trees", value: 60, observedAt: "2025-10-01", followUpOf: o._id });
  assert.equal(r.data.outcome.level, "followup");
  assert.equal((await call("POST", `/api/ops/outcomes/${r.data.outcome._id}/verify`, F.t.teacher, { decision: "verified" })).status, 403);
  await call("POST", `/api/ops/outcomes/${r.data.outcome._id}/verify`, F.t.po, { decision: "verified" });
  assert.equal((await call("POST", `/api/ops/projects/${p._id}/outcomes`, F.t.teacher, { metric: "x", value: 1, observedAt: "2025-06-01", followUpOf: o._id })).status, 400, "follow-up before original");

  assert.equal((await call("POST", `/api/ops/outcomes/${o._id}/partner`, F.t.teacher, { partnerRole: "Panchayat secretary" })).status, 200);
  const s = (await call("GET", `/api/ops/projects/${p._id}/outcomes`, F.t.po)).data.summary;
  const trees = s.find((x) => x.metric === "Trees planted");
  assert.deepEqual([trees.planned, trees.reported, trees.verified, trees.partnerConfirmed], [100, 75, 75, 75]);
  assert.equal(s.find((x) => x.metric.startsWith("Trees surviving")).followup, 60);
  F.outcome = o;
});

test("public impact uses only published verified outcomes and verified hours", async () => {
  await LedgerEntry.create({ institution: F.instA._id, student: F.vol._id, event: session._id, serviceDate: new Date("2025-07-01"), academicYear: 2025, kind: "regular", entryType: "credit", minutes: 180, idempotencyKey: "t1" });
  await LedgerEntry.create({ institution: F.instA._id, student: F.vol2._id, serviceDate: new Date("2024-07-01"), academicYear: 2024, kind: "regular", entryType: "legacy", minutes: 6000, idempotencyKey: "t2" });
  let r = await call("GET", `/api/nss/public/impact/${F.instA._id}`);
  assert.equal(r.data.summary.hours, 3, "legacy hours excluded");
  assert.equal(r.data.summary.volunteers, 1);
  assert.equal(r.data.impact.length, 0, "nothing published; legacy impact unapproved");
  assert.ok(!JSON.stringify(r.data).includes(F.vol.name), "no names");

  assert.equal((await call("POST", `/api/ops/outcomes/${F.outcome._id}/publish`, F.t.teacher, {})).status, 403);
  await call("POST", `/api/ops/outcomes/${F.outcome._id}/publish`, F.t.po, {});
  r = await call("GET", `/api/nss/public/impact/${F.instA._id}`);
  assert.deepEqual(r.data.impact.map((i) => [i.metric, i.value]), [["Trees planted", 75]]);

  await call("POST", `/api/ops/events/${session._id}/impact-public`, F.t.po, { approved: true });
  r = await call("GET", `/api/nss/public/impact/${F.instA._id}`);
  assert.ok(r.data.impact.some((i) => i.metric === "Unverified legacy"), "legacy impact appears only after officer approval");
});
