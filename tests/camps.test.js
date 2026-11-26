import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { client, startEnv } from "./harness.js";
import { TAG, activePolicy, baseFixtures, person } from "./fixtures.js";
import Coordinator from "../models/Coordinator.js";
import Event from "../models/Event.js";
import InstitutionSettings from "../models/InstitutionSettings.js";
import Student from "../models/Student.js";
import { tokenFor } from "./harness.js";

let env, call, F, campId, eventId;
const days = Array.from({ length: 7 }, (_, i) => new Date(Date.UTC(2025, 11, 1 + i, 6)));

before(async () => {
  env = await startEnv();
  call = client(env.base);
  F = await baseFixtures();
  await activePolicy(F.instA, F.po);
  F.principal = await person(Coordinator, F.instA);
  F.t.principal = tokenFor(F.principal, "coordinator");
  // School-style chain: Programme Officer, then a named Principal.
  await InstitutionSettings.create({ institution: F.instA._id, approvalChains: { camp: [{ name: "Programme Officer", approvers: [] }, { name: "Principal", approvers: [F.principal._id] }] } });
  F.vol3 = await person(Student, F.instA, { role: "volunteer", talents: ["x"] });
  F.t.vol3 = tokenFor(F.vol3, "volunteer");
});
after(() => env?.stop());

test("proposal → two-step approval chain → camp event created", async () => {
  let r = await call("POST", "/api/ops/camps", F.t.po, { title: `${TAG} Camp`, startDate: days[0], endDate: days[6], capacity: 2, supervisors: [F.teacher._id], requiredDocuments: ["fitness_declaration"], guardianPermissionRequired: true, site: { community: "Synthetic village" } });
  assert.equal(r.status, 201);
  campId = r.data.camp._id;
  assert.equal((await call("POST", `/api/ops/camps/${campId}/transition`, F.t.po, { action: "approve" })).status, 409, "draft cannot be approved");
  await call("POST", `/api/ops/camps/${campId}/transition`, F.t.po, { action: "submit" });
  assert.equal((await call("POST", `/api/ops/camps/${campId}/transition`, F.t.principal, { action: "approve" })).status, 200, "principal could sign PO step as any officer");
  // Second step is the named Principal; the same person can't sign twice, other officers aren't listed.
  assert.equal((await call("POST", `/api/ops/camps/${campId}/transition`, F.t.principal, { action: "approve" })).status, 403);
  assert.equal((await call("POST", `/api/ops/camps/${campId}/transition`, F.t.po, { action: "approve" })).status, 403);
  assert.equal((await call("POST", `/api/ops/camps/${campId}/transition`, F.t.poB, { action: "approve" })).status, 404);
});

test("approval chain completes with a distinct signer", async () => {
  // Reset: reject path needs reason; instead re-run with PO first.
  const r0 = await call("POST", "/api/ops/camps", F.t.po, { title: `${TAG} Camp 2`, startDate: days[0], endDate: days[6], capacity: 2, supervisors: [F.teacher._id], requiredDocuments: ["fitness_declaration"], guardianPermissionRequired: true });
  campId = r0.data.camp._id;
  await call("POST", `/api/ops/camps/${campId}/transition`, F.t.po, { action: "submit" });
  assert.equal((await call("POST", `/api/ops/camps/${campId}/transition`, F.t.po, { action: "approve" })).status, 200);
  const r = await call("POST", `/api/ops/camps/${campId}/transition`, F.t.principal, { action: "approve", reason: "Approved" });
  assert.equal(r.data.camp.status, "approved");
  eventId = r.data.camp.event;
  const ev = await Event.findById(eventId).lean();
  assert.equal(ev.type, "special_camp");
  assert.equal(ev.status, "Upcoming");
});

test("applications, capacity, waiting list, documents gate confirmation, promotion", async () => {
  for (const t of [F.t.vol, F.t.vol2, F.t.vol3]) assert.equal((await call("POST", `/api/ops/camps/${campId}/apply`, t)).status, 201);
  assert.equal((await call("POST", `/api/ops/camps/${campId}/apply`, F.t.vol)).status, 409);
  assert.equal((await call("POST", `/api/ops/camps/${campId}/apply`, F.t.volB)).status, 404);
  for (const s of [F.vol, F.vol2]) assert.equal((await call("POST", `/api/ops/camps/${campId}/applications`, F.t.po, { student: s._id, action: "select" })).data.status, "selected");
  assert.equal((await call("POST", `/api/ops/camps/${campId}/applications`, F.t.po, { student: F.vol3._id, action: "select" })).data.status, "waitlisted");

  let r = await call("POST", `/api/ops/camps/${campId}/applications`, F.t.po, { student: F.vol._id, action: "confirm" });
  assert.equal(r.status, 400);
  assert.match(r.data.message, /guardian_consent|fitness_declaration/);
  for (const type of ["guardian_consent", "fitness_declaration"]) assert.equal((await call("POST", `/api/ops/camps/${campId}/documents`, F.t.teacher, { student: F.vol._id, type, status: "verified" })).status, 200);
  assert.equal((await call("POST", `/api/ops/camps/${campId}/applications`, F.t.po, { student: F.vol._id, action: "confirm" })).data.status, "confirmed");
  assert.ok((await Event.findById(eventId).lean()).participants.some((p) => String(p) === String(F.vol._id)));

  r = await call("POST", `/api/ops/camps/${campId}/applications`, F.t.po, { student: F.vol2._id, action: "withdraw" });
  assert.equal(r.data.camp.applications.find((a) => String(a.student) === String(F.vol3._id)).status, "selected", "waitlist promoted");
});

test("emergency contacts and incidents are restricted", async () => {
  assert.equal((await call("PUT", `/api/ops/camps/${campId}/emergency-contacts`, F.t.vol, { name: "SYNTHETIC Parent", relation: "Parent", phone: "+91 00000 00000" })).status, 200);
  const general = await call("GET", `/api/ops/camps/${campId}`, F.t.po);
  assert.ok(!JSON.stringify(general.data).includes("00000 00000"), "general camp view has no contacts");
  const vol = await call("GET", `/api/ops/camps/${campId}`, F.t.vol);
  assert.ok(!JSON.stringify(vol.data).includes("SYNTHETIC Parent"));
  assert.equal((await call("GET", `/api/ops/camps/${campId}/emergency-contacts`, F.t.vol)).status, 403);
  assert.equal((await call("GET", `/api/ops/camps/${campId}/emergency-contacts`, F.t.otherTeacher)).status, 403);
  assert.equal((await call("GET", `/api/ops/camps/${campId}/emergency-contacts`, F.t.poB)).status, 404);
  const c = await call("GET", `/api/ops/camps/${campId}/emergency-contacts`, F.t.teacher);
  assert.equal(c.data.contacts.length, 1);

  assert.equal((await call("POST", `/api/ops/camps/${campId}/incidents`, F.t.vol2, { occurredAt: days[1], category: "health", severity: "low", description: "x" })).status, 403, "non-confirmed volunteer");
  assert.equal((await call("POST", `/api/ops/camps/${campId}/incidents`, F.t.vol, { occurredAt: days[1], category: "health", severity: "low", description: "SYNTHETIC minor cut", involved: [F.vol._id] })).status, 201);
  const own = await call("GET", `/api/ops/camps/${campId}/incidents`, F.t.vol);
  assert.ok(!("description" in own.data.incidents[0]), "reporter sees status, not details list");
  assert.equal((await call("GET", `/api/ops/camps/${campId}/incidents`, F.t.otherTeacher)).status, 403);
  assert.equal((await call("GET", `/api/ops/camps/${campId}/incidents`, F.t.teacher)).data.incidents[0].description, "SYNTHETIC minor cut");
});

test("completion from verified daily evidence; missing days explicit; exceptions need a basis", async () => {
  await call("POST", `/api/ops/camps/${campId}/transition`, F.t.po, { action: "start" });
  // Daily roll call + diary credits for 6 of 7 days.
  await Event.updateOne({ _id: eventId }, { $set: { campDays: days.map((d) => ({ date: d, present: [F.vol._id] })) } });
  for (const d of days.slice(0, 6)) {
    const e = (await call("POST", "/api/ops/diary", F.t.vol, { event: eventId, serviceDate: d, claimedMinutes: 300, workDone: "Camp work" })).data.entry;
    assert.equal((await call("POST", `/api/ops/diary/${e._id}/submit`, F.t.vol)).status, 200);
    assert.equal((await call("POST", `/api/ops/diary/${e._id}/decide`, F.t.teacher, { action: "approve" })).status, 200);
  }
  assert.equal((await call("POST", `/api/ops/camps/${campId}/completion`, F.t.po, { student: F.vol._id, decision: "complete" })).status, 409, "camp not completed yet");
  await call("POST", `/api/ops/camps/${campId}/transition`, F.t.po, { action: "complete" });
  const review = (await call("GET", `/api/ops/camps/${campId}/completion`, F.t.po)).data;
  const row = review.rows.find((r) => String(r.student) === String(F.vol._id));
  assert.equal(row.daysCredited, 6);
  assert.deepEqual(row.missingDays, ["2025-12-07"]);
  assert.equal((await call("POST", `/api/ops/camps/${campId}/completion`, F.t.po, { student: F.vol._id, decision: "complete" })).status, 400);
  assert.equal((await call("POST", `/api/ops/camps/${campId}/completion`, F.t.po, { student: F.vol._id, decision: "exception", reason: "Hospitalised on final day" })).status, 400);
  assert.equal((await call("POST", `/api/ops/camps/${campId}/completion`, F.t.po, { student: F.vol._id, decision: "exception", reason: "Hospitalised on final day", basis: "SYNTHETIC policy clause" })).status, 200);

  assert.equal((await call("POST", `/api/ops/camps/${campId}/closing-report`, F.t.teacher, { summary: "SYNTHETIC camp completed with 1 volunteer." })).status, 200);
  assert.equal((await call("POST", `/api/ops/camps/${campId}/closing-report`, F.t.teacher, { action: "review" })).status, 403);
  const r = await call("POST", `/api/ops/camps/${campId}/closing-report`, F.t.po, { action: "review", notes: "OK" });
  assert.equal(r.data.camp.status, "reviewed");
  assert.equal((await call("PATCH", `/api/ops/camps/${campId}`, F.t.po, { objectives: "changed" })).status, 409, "reviewed camp is locked");
});
