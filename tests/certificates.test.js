import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { client, startEnv } from "./harness.js";
import { activePolicy, baseFixtures } from "./fixtures.js";
import LedgerEntry from "../models/LedgerEntry.js";
import Certificate from "../models/Certificate.js";

let env, call, F;
const credit = (student, inst, over) => LedgerEntry.create({ institution: inst._id, student: student._id, entryType: "credit", kind: "regular", category: "general", idempotencyKey: `t:${Math.random()}`, ...over });

before(async () => {
  env = await startEnv();
  call = client(env.base);
  F = await baseFixtures();
  F.policy = await activePolicy(F.instA, F.po);
  // Two consecutive years of 120 h and a 7-day camp, all verified.
  await credit(F.vol, F.instA, { serviceDate: new Date("2023-08-01"), academicYear: 2023, minutes: 7200 });
  await credit(F.vol, F.instA, { serviceDate: new Date("2024-08-01"), academicYear: 2024, minutes: 7200 });
  for (let d = 1; d <= 7; d++) await credit(F.vol, F.instA, { kind: "camp", event: F.policy._id, serviceDate: new Date(Date.UTC(2024, 11, d)), academicYear: 2024, minutes: 360 });
  await credit(F.vol2, F.instA, { serviceDate: new Date("2024-08-01"), academicYear: 2024, minutes: 14400 });
});
after(() => env?.stop());

test("prepare → independent review → issue → verify → revoke → reissue", async () => {
  let r = await call("GET", `/api/ops/certificates/preview?student=${F.vol._id}&policy=${F.policy._id}`, F.t.po);
  assert.equal(r.data.evaluation.met, true);

  r = await call("POST", "/api/ops/certificates", F.t.po, { student: F.vol._id, policy: F.policy._id });
  assert.equal(r.status, 201);
  const cert = r.data.certificate;
  assert.equal(cert.status, "pending_review");
  assert.equal(cert.policyVersion, 1);

  // Drafts are not publicly verifiable.
  assert.equal((await call("GET", `/api/public/verify/${cert.certId}`)).status, 404);
  // Duplicate live certificate refused.
  assert.equal((await call("POST", "/api/ops/certificates", F.t.po, { student: F.vol._id, policy: F.policy._id })).status, 409);
  // Preparer cannot self-issue when another officer exists; volunteers and teachers cannot issue.
  assert.equal((await call("POST", `/api/ops/certificates/${cert._id}/review`, F.t.po, { action: "issue" })).status, 403);
  assert.equal((await call("POST", `/api/ops/certificates/${cert._id}/review`, F.t.teacher, { action: "issue" })).status, 403);
  assert.equal((await call("POST", `/api/ops/certificates/${cert._id}/review`, F.t.vol, { action: "issue" })).status, 403);
  assert.equal((await call("POST", `/api/ops/certificates/${cert._id}/review`, F.t.poB, { action: "issue" })).status, 404);

  r = await call("POST", `/api/ops/certificates/${cert._id}/review`, F.t.po2, { action: "issue" });
  assert.equal(r.data.certificate.status, "issued");

  r = await call("GET", `/api/public/verify/${cert.certId}`);
  assert.equal(r.data.valid, true);
  assert.equal(r.data.certificate.kind, "nss_completion");
  assert.ok(!JSON.stringify(r.data).includes("@example.test"), "no contact details in public verification");

  const pdf = await fetch(`${env.base}/api/ops/certificates/${cert._id}/pdf`, { headers: { authorization: `Bearer ${F.t.vol}` } });
  assert.equal(pdf.headers.get("content-type"), "application/pdf");
  assert.equal((await fetch(`${env.base}/api/ops/certificates/${cert._id}/pdf`, { headers: { authorization: `Bearer ${F.t.vol2}` } })).status, 404);

  assert.equal((await call("POST", `/api/ops/certificates/${cert._id}/revoke`, F.t.po, {})).status, 400, "reason required");
  r = await call("POST", `/api/ops/certificates/${cert._id}/revoke`, F.t.po, { reason: "Test revocation" });
  assert.equal(r.data.certificate.status, "revoked");
  r = await call("GET", `/api/public/verify/${cert.certId}`);
  assert.equal(r.data.valid, false);
  assert.equal(r.data.certificate.status, "revoked");

  r = await call("POST", `/api/ops/certificates/${cert._id}/reissue`, F.t.po, { reason: "Name corrected" });
  assert.equal(r.status, 201);
  const next = r.data.certificate;
  assert.equal(String(next.supersedes), String(cert._id));
  await call("POST", `/api/ops/certificates/${next._id}/review`, F.t.po2, { action: "issue" });
  r = await call("GET", `/api/public/verify/${cert.certId}`);
  assert.equal(r.data.certificate.status, "superseded");
  assert.equal(r.data.certificate.replacedBy, next.certId);
  const list = (await call("GET", "/api/ops/certificates", F.t.po)).data.certificates;
  assert.equal(list.length, 2, "original record preserved");
});

test("unmet requirements need a recorded exception with policy basis", async () => {
  let r = await call("POST", "/api/ops/certificates", F.t.po, { student: F.vol2._id, policy: F.policy._id });
  assert.equal(r.status, 400, "single heavy year and no camp is not completion");
  r = await call("POST", "/api/ops/certificates", F.t.po, { student: F.vol2._id, policy: F.policy._id, exception: { reason: "Medical exemption from camp", basis: "SYNTHETIC rule 4(b)" } });
  assert.equal(r.status, 201);
  assert.equal(r.data.certificate.exception.granted, true);
});

test("event participation certificate revocation keeps the record", async () => {
  await Certificate.create({ certId: "NSS-TESTREVOKE1", student: F.vol._id, event: F.policy._id, institution: F.instA._id, studentName: "x", eventTitle: "SYNTHETIC" });
  assert.equal((await call("GET", "/api/public/verify/NSS-TESTREVOKE1")).data.valid, true);
  assert.equal((await call("POST", "/api/ops/event-certificates/NSS-TESTREVOKE1/revoke", F.t.poB, { reason: "x x x" })).status, 404);
  assert.equal((await call("POST", "/api/ops/event-certificates/NSS-TESTREVOKE1/revoke", F.t.po, { reason: "Issued in error" })).status, 200);
  const r = await call("GET", "/api/public/verify/NSS-TESTREVOKE1");
  assert.equal(r.data.valid, false);
  assert.equal(r.data.certificate.status, "revoked");
});

test("recalculation under a different policy is previewed, then explicitly recorded; credits untouched", async () => {
  const ServicePolicy = (await import("../models/ServicePolicy.js")).default;
  await LedgerEntry.updateMany({ student: F.vol._id }, { $set: { policyVersion: 1 } });
  const v2 = await ServicePolicy.create({ ...F.policy.toObject(), _id: undefined, version: 2, status: "draft", rules: { ...F.policy.rules.toObject(), regularMinutesPerYear: 9000 }, changeReason: "Higher local target" });
  const before = await LedgerEntry.find({ student: F.vol._id }).lean();
  let r = await call("POST", "/api/ops/policies/recalculate", F.t.po, { student: F.vol._id, policy: v2._id });
  assert.equal(r.data.preview, true);
  assert.equal(r.data.before[0].met, true);
  assert.equal(r.data.after.met, false);
  assert.equal((await call("POST", "/api/ops/policies/recalculate", F.t.po, { student: F.vol._id, policy: v2._id, record: true })).status, 400, "reason required");
  r = await call("POST", "/api/ops/policies/recalculate", F.t.po, { student: F.vol._id, policy: v2._id, record: true, reason: "Board asked for comparison" });
  assert.equal(r.status, 201);
  assert.deepEqual(r.data.recalculation.originalPolicyVersions, [1]);
  const afterRows = await LedgerEntry.find({ student: F.vol._id }).lean();
  assert.deepEqual(afterRows.map((x) => [x.minutes, x.policyVersion]), before.map((x) => [x.minutes, x.policyVersion]));
  assert.equal((await call("POST", "/api/ops/policies/recalculate", F.t.poB, { student: F.vol._id, policy: v2._id })).status, 404);
});
