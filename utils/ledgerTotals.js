// Ledger-backed totals shared by eligibility, matching, leaderboard, dashboards
// and reports, so every screen agrees with the passbook.
import mongoose from "mongoose";
import LedgerEntry from "../models/LedgerEntry.js";
import ServicePolicy from "../models/ServicePolicy.js";
import { academicYearFor, academicYearBounds, evaluatePolicy, summariseLedger } from "./serviceRules.js";

const T = (o) => mongoose.trusted(o);
const h = (m) => Math.round((m / 60) * 100) / 100;

export const activePolicy = (institution, at = new Date(), family = "nss-certificate") =>
  ServicePolicy.findOne({
    institution,
    family,
    status: "active",
    effectiveFrom: T({ $lte: at }),
    $or: [{ effectiveTo: null }, { effectiveTo: T({ $exists: false }) }, { effectiveTo: T({ $gt: at }) }],
  })
    .sort({ version: -1 })
    .lean();

// Map<studentId, entries[]>
export const ledgerByStudent = async (institution, studentIds) => {
  const q = { institution };
  if (studentIds) q.student = T({ $in: studentIds.map((id) => new mongoose.Types.ObjectId(String(id))) });
  const rows = await LedgerEntry.find(q).select("student event serviceDate academicYear kind category entryType minutes programme").lean();
  const map = new Map((studentIds || []).map((id) => [String(id), []]));
  for (const r of rows) {
    const k = String(r.student);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(r);
  }
  return map;
};

// Same shape as the legacy computeEligibility rows, plus explicit sources.
export const ledgerEligibility = async (institution, studentIds, now = new Date()) => {
  const [byStudent, policy] = await Promise.all([ledgerByStudent(institution, studentIds), activePolicy(institution, now)]);
  const rules = policy?.rules;
  const startMonth = rules?.academicYearStartMonth || 6;
  const year = academicYearFor(now, startMonth);
  const { start, end } = academicYearBounds(year, startMonth);
  const elapsed = Math.min(1, Math.max(0, (now - start) / (end - start)));
  const perYear = rules?.regularMinutesPerYear || 0;
  const target = perYear * (rules?.yearsRequired || 0);
  const out = new Map();
  for (const [id, entries] of byStudent) {
    const s = summariseLedger(entries, startMonth);
    const legacyByYear = {};
    for (const e of entries) if (e.entryType === "legacy") legacyByYear[e.academicYear] = (legacyByYear[e.academicYear] || 0) + e.minutes;
    const ev = rules ? evaluatePolicy(s, rules, { legacyByYear }) : null;
    const thisYear = s.byYear[year] || 0;
    out.set(id, {
      source: "ledger",
      policy: policy ? { _id: policy._id, name: policy.name, version: policy.version } : null,
      total: h(s.verifiedRegular),
      campHours: h(s.verifiedCamp),
      legacyHours: h(s.legacy),
      currentYear: h(thisYear),
      years: (ev?.years || Object.entries(s.byYear).map(([y, m]) => ({ year: Number(y), minutes: m }))).map((y) => ({ ...y, hours: h(y.minutes) })),
      qualifyingYears: ev?.qualifyingYears?.length || 0,
      camps: ev?.camp?.camps || [],
      campDone: Boolean(ev?.camp?.met && ev?.camp?.required),
      eligible: Boolean(ev?.met),
      remainingHours: target ? h(Math.max(0, target - s.verifiedRegular)) : 0,
      behindPace: Boolean(rules && !ev?.met && thisYear < perYear * elapsed * 0.75),
      expectedThisYear: Math.round(h(perYear * elapsed)),
    });
  }
  return { map: out, policy };
};

// Verified minutes per student for one academic year (regular, non-legacy).
export const yearMinutesByStudent = async (institution, year) => {
  const rows = await LedgerEntry.aggregate([
    { $match: { institution: new mongoose.Types.ObjectId(String(institution)), academicYear: year, entryType: { $ne: "legacy" }, programme: { $ne: "community_service" } } },
    { $group: { _id: { s: "$student", k: "$kind" }, minutes: { $sum: "$minutes" } } },
  ]);
  const m = new Map();
  for (const r of rows) {
    const k = String(r._id.s);
    const v = m.get(k) || { regular: 0, camp: 0 };
    v[r._id.k] += r.minutes;
    m.set(k, v);
  }
  return m;
};
