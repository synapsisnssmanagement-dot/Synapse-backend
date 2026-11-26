import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { client, startEnv } from "./harness.js";
import { activePolicy, baseFixtures } from "./fixtures.js";
import Event from "../models/Event.js";
import LedgerEntry from "../models/LedgerEntry.js";

let env, call, F;
const credit = (s, over) => LedgerEntry.create({ institution: F.instA._id, student: s._id, entryType: "credit", kind: "regular", category: "general", academicYear: 2025, idempotencyKey: `k${Math.random()}`, ...over });

before(async () => {
  env = await startEnv();
  call = client(env.base);
  F = await baseFixtures();
  await activePolicy(F.instA, F.po);
  const ev = await Event.create({ title: "=HYPERLINK(\"x\") SYNTHETIC", description: "x", date: new Date("2025-08-01"), location: "x", institution: F.instA._id, status: "Completed" });
  const c = await credit(F.vol, { event: ev._id, serviceDate: new Date("2025-08-01"), minutes: 150, category: "health" });
  await LedgerEntry.create({ ...c.toObject(), _id: undefined, entryType: "adjustment", minutes: -30, adjusts: c._id, idempotencyKey: "adj1" });
  await credit(F.vol2, { serviceDate: new Date("2025-09-01"), minutes: 240 });
  await credit(F.vol2, { serviceDate: new Date("2025-12-01"), minutes: 360, kind: "camp" });
  await credit(F.vol2, { serviceDate: new Date("2024-12-01"), minutes: 999, entryType: "legacy" });
  await credit(F.vol2, { serviceDate: new Date("2026-07-01"), minutes: 60 }); // outside period
});
after(() => env?.stop());

const period = { from: "2025-06-01", to: "2026-06-01" };

test("every report type generates as a draft with provenance", async () => {
  const types = (await call("GET", "/api/ops/reports/types", F.t.po)).data.types;
  assert.equal(types.length, 10);
  for (const t of types) {
    const r = await call("POST", "/api/ops/reports", F.t.po, { type: t.id, ...period });
    assert.equal(r.status, 201, `${t.id}: ${r.data?.message}`);
    assert.equal(r.data.report.status, "draft");
    assert.equal(r.data.report.policy.version, 1);
    assert.ok(r.data.report.checksum.length === 64);
  }
  assert.equal((await call("POST", "/api/ops/reports", F.t.teacher, { type: "periodic", ...period })).status, 403);
});

test("service summary totals equal the ledger and the passbooks", async () => {
  const r = (await call("POST", "/api/ops/reports", F.t.po, { type: "service_summary", ...period })).data.report;
  assert.equal(r.data.totals.verifiedRegularMinutes, 120 + 240, "net of adjustment, within period");
  assert.equal(r.data.totals.verifiedCampMinutes, 360);
  const a = (await call("GET", "/api/ops/passbook/me", F.t.vol)).data.summary;
  assert.equal(a.verifiedRegularMinutes, 120);
  const agg = await LedgerEntry.aggregate([{ $match: { institution: F.instA._id, entryType: { $ne: "legacy" }, kind: "regular", serviceDate: { $gte: new Date(period.from), $lt: new Date(period.to) } } }, { $group: { _id: null, m: { $sum: "$minutes" } } }]);
  assert.equal(r.data.totals.verifiedRegularMinutes, agg[0].m);
  const periodic = (await call("POST", "/api/ops/reports", F.t.po, { type: "periodic", ...period })).data.report;
  assert.equal(periodic.data.totals.verifiedRegularMinutes, r.data.totals.verifiedRegularMinutes, "reports agree with each other");
  F.report = r;
});

test("approval by a second officer; CSV escapes formulas; PDF marks drafts; isolation", async () => {
  const csv = await (await fetch(`${env.base}/api/ops/reports/${F.report._id}/csv`, { headers: { authorization: `Bearer ${F.t.po}` } })).text();
  assert.match(csv, /DRAFT — not approved/);
  const ev = (await call("POST", "/api/ops/reports", F.t.po, { type: "periodic", ...period })).data.report;
  const evCsv = await (await fetch(`${env.base}/api/ops/reports/${ev._id}/csv`, { headers: { authorization: `Bearer ${F.t.po}` } })).text();
  assert.ok(evCsv.includes(`"'=HYPERLINK(""x"") SYNTHETIC"`), "formula neutralised");
  assert.equal((await call("POST", `/api/ops/reports/${F.report._id}/approve`, F.t.po)).status, 403);
  assert.equal((await call("POST", `/api/ops/reports/${F.report._id}/approve`, F.t.po2)).data.report.status, "approved");
  const pdf = await fetch(`${env.base}/api/ops/reports/${F.report._id}/pdf`, { headers: { authorization: `Bearer ${F.t.po}` } });
  assert.equal(pdf.headers.get("content-type"), "application/pdf");
  assert.equal((await call("GET", `/api/ops/reports/${F.report._id}`, F.t.poB)).status, 404);
  assert.equal((await call("GET", `/api/ops/reports/${F.report._id}`, F.t.po)).data.intact, true);
});

test("templates are versioned and used for new reports", async () => {
  const t = (await call("POST", "/api/ops/reports/templates", F.t.po, { type: "service_summary", title: "SYNTHETIC Annual service register", signatories: ["Programme Officer", "Principal", "University NSS Coordinator"], changeReason: "University format" })).data.template;
  assert.equal(t.version, 1);
  await call("POST", `/api/ops/reports/templates/${t._id}/activate`, F.t.po);
  const r = (await call("POST", "/api/ops/reports", F.t.po, { type: "service_summary", ...period })).data.report;
  assert.equal(r.templateVersion, 1);
  assert.equal(r.signatories.length, 3);
});
