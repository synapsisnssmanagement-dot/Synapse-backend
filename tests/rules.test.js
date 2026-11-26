import assert from "node:assert/strict";
import { test } from "node:test";
import { academicYearFor, canTransition, creditKey, evaluatePolicy, missingCampDays, summariseLedger } from "../utils/serviceRules.js";
import { computeEligibility } from "../utils/nss.js";

const rules = { regularMinutesPerYear: 7200, yearsRequired: 2, consecutiveYears: true, categories: [], camp: { required: true, requiredDays: 7 } };
const credit = (y, minutes, extra = {}) => ({ entryType: "credit", kind: "regular", academicYear: y, serviceDate: new Date(Date.UTC(y, 7, 1)), minutes, ...extra });
const campDays = (event, n) => Array.from({ length: n }, (_, i) => ({ entryType: "credit", kind: "camp", event, serviceDate: new Date(Date.UTC(2025, 0, 1 + i)), minutes: 360 }));

test("academic year boundary is the first instant of the start month (UTC)", () => {
  assert.equal(academicYearFor("2025-05-31T23:59:59Z"), 2024);
  assert.equal(academicYearFor("2025-06-01T00:00:00Z"), 2025);
  assert.equal(academicYearFor("2025-03-31T23:59:59Z", 4), 2024);
  assert.equal(academicYearFor("2025-04-01T00:00:00Z", 4), 2025);
});

test("lifetime total alone does not establish two-year completion", () => {
  const s = summariseLedger([credit(2024, 14400), ...campDays("c1", 7)]);
  const r = evaluatePolicy(s, rules);
  assert.equal(r.yearsMet, false);
  assert.equal(r.met, false);
});

test("consecutive-year rule", () => {
  const gap = evaluatePolicy(summariseLedger([credit(2022, 7200), credit(2024, 7200), ...campDays("c", 7)]), rules);
  assert.equal(gap.yearsMet, false);
  const ok = evaluatePolicy(summariseLedger([credit(2023, 7200), credit(2024, 7200), ...campDays("c", 7)]), rules);
  assert.equal(ok.met, true);
  const nonConsec = evaluatePolicy(summariseLedger([credit(2022, 7200), credit(2024, 7200), ...campDays("c", 7)]), { ...rules, consecutiveYears: false });
  assert.equal(nonConsec.met, true);
});

test("camp service is kept separate from regular service and needs the required days", () => {
  const s = summariseLedger([credit(2024, 7200), credit(2025, 3600), ...campDays("c", 4)]);
  assert.equal(s.verifiedRegular, 10800);
  assert.equal(s.verifiedCamp, 1440);
  const r = evaluatePolicy(s, rules);
  assert.equal(r.camp.met, false);
  assert.equal(r.camp.camps[0].daysAttended, 4);
});

test("legacy minutes are reported separately and count only when the policy says so", () => {
  const s = summariseLedger([{ entryType: "legacy", kind: "regular", academicYear: 2024, minutes: 7200 }, credit(2025, 7200), ...campDays("c", 7)]);
  assert.equal(s.legacy, 7200);
  assert.equal(s.verifiedRegular, 7200);
  assert.equal(evaluatePolicy(s, rules, { legacyByYear: { 2024: 7200 } }).met, false);
  assert.equal(evaluatePolicy(s, { ...rules, countLegacy: true }, { legacyByYear: { 2024: 7200 } }).met, true);
});

test("adjustments net against credits", () => {
  const s = summariseLedger([credit(2024, 300), { ...credit(2024, -120), entryType: "adjustment" }]);
  assert.equal(s.verifiedRegular, 180);
});

test("category minimums", () => {
  const r = evaluatePolicy(summariseLedger([credit(2024, 600, { category: "health" })]), { categories: [{ name: "health", minMinutes: 600 }, { name: "literacy", minMinutes: 60 }] });
  assert.deepEqual(r.categories.map((c) => c.met), [true, false]);
});

test("missing camp days are listed explicitly", () => {
  const miss = missingCampDays({ date: "2025-01-01T00:00:00Z", endDate: "2025-01-07T00:00:00Z" }, new Set(["2025-01-01", "2025-01-03"]));
  assert.deepEqual(miss, ["2025-01-02", "2025-01-04", "2025-01-05", "2025-01-06", "2025-01-07"]);
});

test("diary state machine", () => {
  assert.ok(canTransition("draft", "submitted"));
  assert.ok(canTransition("returned", "submitted"));
  assert.ok(!canTransition("approved", "submitted"));
  assert.ok(!canTransition("rejected", "approved"));
  assert.ok(!canTransition("draft", "approved"));
});

test("credit key is per volunteer, activity and day", () => {
  const a = creditKey({ student: "s", event: "e", serviceDate: "2025-01-01T08:00:00Z" });
  const b = creditKey({ student: "s", event: "e", serviceDate: "2025-01-01T17:00:00Z" });
  assert.equal(a, b);
});

test("legacy eligibility: half a camp and a single heavy year no longer qualify", () => {
  const sid = "507f1f77bcf86cd799439011";
  const camp = { _id: "c", type: "special_camp", date: new Date(Date.UTC(2025, 0, 1)), hours: 6, campDays: Array.from({ length: 8 }, (_, i) => ({ date: new Date(Date.UTC(2025, 0, 1 + i)), present: i < 4 ? [sid] : [] })) };
  const big = { _id: "e", type: "regular", date: new Date(Date.UTC(2024, 7, 1)), calculatedHours: 300, attendance: [{ student: sid, status: "Present" }] };
  const e = computeEligibility([sid], [camp, big], new Date(Date.UTC(2025, 2, 1))).get(sid);
  assert.equal(e.campDone, false);
  assert.equal(e.qualifyingYears, 1);
  assert.equal(e.eligible, false);
});

test("legacy import plan: one row per volunteer per event, keyed for idempotency", async () => {
  const { planLegacyImport } = await import("../utils/legacyImport.js");
  const ev = { _id: "e1", institution: "i", type: "regular", date: new Date(Date.UTC(2024, 8, 1)), calculatedHours: 2.5, attendance: [{ student: "s1", status: "Present" }, { student: "s2", status: "Absent" }] };
  const rows = planLegacyImport([ev, ev], "b");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].minutes, 150);
  assert.equal(rows[0].idempotencyKey, rows[1].idempotencyKey);
  assert.equal(rows[0].entryType, "legacy");
});
