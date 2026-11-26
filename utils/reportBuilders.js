// Report builders. Each returns { columns, rows, totals, notes } computed
// from approved/recorded data only. Service totals come from the ledger, so
// they always equal the passbook and eligibility figures.
import mongoose from "mongoose";
import AttendanceRecord from "../models/AttendanceRecord.js";
import CampPlan from "../models/CampPlan.js";
import CompletionCertificate from "../models/CompletionCertificate.js";
import DiaryEntry from "../models/DiaryEntry.js";
import Enrolment from "../models/Enrolment.js";
import Event from "../models/Event.js";
import Grievance from "../models/Grievance.js";
import LedgerEntry from "../models/LedgerEntry.js";
import OutcomeRecord from "../models/OutcomeRecord.js";
import Project from "../models/Project.js";
import { StockItem } from "../models/StockItem.js";
import Student from "../models/Student.js";
import { missingCampDays, dayKey } from "./serviceRules.js";

const T = (o) => mongoose.trusted(o);
const h = (m) => Math.round((m / 60) * 100) / 100;
const names = async (ids) => new Map((await Student.find({ _id: T({ $in: [...new Set(ids.map(String))] }) }).select("name department").lean()).map((s) => [String(s._id), s]));
const inRange = (from, to) => T({ $gte: from, $lt: to });

export const REPORT_TYPES = {
  enrolment_register: "Enrolment register",
  attendance_register: "Attendance register",
  volunteer_diary: "Volunteer diary register",
  service_summary: "Regular service and category summary",
  camp_register: "Camp register and closing report",
  periodic: "Activity report (monthly / quarterly / annual)",
  pending_documents: "Pending documents and permissions checklist",
  finance_stock: "Financial and stock summary",
  award_evidence: "Award nomination evidence",
  handover_pack: "Programme Officer handover pack",
};

const builders = {
  async enrolment_register({ institution, from, to, unit }) {
    const q = { institution, createdAt: inRange(from, to) };
    if (unit) q.unit = unit;
    const rows = await Enrolment.find(q).populate("student", "name department").populate("unit", "code").sort({ createdAt: 1 }).lean();
    return {
      columns: ["Volunteer", "Department", "Unit", "Academic year", "Level", "Batch", "Status", "Guardian permission"],
      rows: rows.map((e) => [e.student?.name, e.student?.department, e.unit?.code, e.academicYear, e.level, e.batch, e.status, e.guardianPermission?.required ? (e.guardianPermission.received ? "received" : "REQUIRED — not received") : "n/a"]),
      totals: { enrolments: rows.length },
      notes: ["Contact details are not included."],
    };
  },
  async attendance_register({ institution, from, to }) {
    const recs = await AttendanceRecord.find({ institution, sessionDate: T({ $gte: dayKey(from), $lt: dayKey(to) }) }).populate("event", "title").sort({ sessionDate: 1 }).lean();
    const n = await names(recs.map((r) => r.student));
    return {
      columns: ["Date", "Activity", "Volunteer", "Status", "Minutes", "Recorded by method", "Verification"],
      rows: recs.map((r) => [r.sessionDate, r.event?.title, n.get(String(r.student))?.name, r.status, r.minutes ?? "", r.method, r.verification]),
      totals: { records: recs.length, verified: recs.filter((r) => r.verification === "verified").length, unverified: recs.filter((r) => r.verification !== "verified").length },
      notes: ["Session-level records only. Location data is not included. Unverified and disputed records are listed but do not earn credit."],
    };
  },
  async volunteer_diary({ institution, from, to }) {
    const ds = await DiaryEntry.find({ institution, serviceDate: inRange(from, to), status: T({ $ne: "draft" }) }).populate("event", "title").sort({ serviceDate: 1 }).lean();
    const n = await names(ds.map((d) => d.student));
    return {
      columns: ["Date", "Volunteer", "Activity", "Claimed (min)", "Approved (min)", "Status", "Last decision reason", "Work performed"],
      rows: ds.map((d) => {
        const last = d.decisions.at(-1);
        return [dayKey(d.serviceDate), n.get(String(d.student))?.name, d.event?.title || d.externalOrganisation, d.claimedMinutes, d.status === "approved" ? last?.approvedMinutes : "", d.status, last?.reason || "", d.workDone.slice(0, 300)];
      }),
      totals: { entries: ds.length, approved: ds.filter((d) => d.status === "approved").length },
      notes: [],
    };
  },
  async service_summary({ institution, from, to }) {
    const entries = await LedgerEntry.find({ institution, serviceDate: inRange(from, to) }).lean();
    const by = new Map();
    for (const e of entries) {
      const k = String(e.student);
      const s = by.get(k) || { regular: 0, camp: 0, legacy: 0, community: 0, cats: {} };
      if (e.entryType === "legacy") s.legacy += e.minutes;
      else if (e.programme === "community_service") s.community += e.minutes;
      else if (e.kind === "camp") s.camp += e.minutes;
      else {
        s.regular += e.minutes;
        s.cats[e.category] = (s.cats[e.category] || 0) + e.minutes;
      }
      by.set(k, s);
    }
    const n = await names([...by.keys()]);
    const rows = [...by].map(([k, s]) => [n.get(k)?.name, n.get(k)?.department, h(s.regular), h(s.camp), Object.entries(s.cats).map(([c, m]) => `${c}: ${h(m)} h`).join("; "), h(s.legacy), h(s.community)]);
    const sum = (f) => [...by.values()].reduce((a, s) => a + s[f], 0);
    return {
      columns: ["Volunteer", "Department", "Verified regular (h)", "Verified camp (h)", "Regular by category", "Legacy imported (h)", "Community service, not NSS (h)"],
      rows: rows.sort((a, b) => b[2] - a[2]),
      totals: { verifiedRegularMinutes: sum("regular"), verifiedCampMinutes: sum("camp"), legacyMinutes: sum("legacy"), communityServiceMinutes: sum("community"), volunteers: by.size },
      notes: ["Verified figures come from the service ledger (approved credits net of adjustments). Legacy and community-service figures are shown separately and are not NSS-verified service."],
    };
  },
  async camp_register({ institution, from, to }) {
    const camps = await CampPlan.find({ institution, startDate: inRange(from, to) }).select("-emergencyContacts").populate("applications.student", "name").lean();
    const rows = [];
    for (const c of camps) {
      const credits = c.event ? await LedgerEntry.find({ event: c.event, kind: "camp", entryType: T({ $ne: "legacy" }) }).select("student serviceDate minutes").lean() : [];
      for (const a of c.applications.filter((x) => x.status === "confirmed")) {
        const days = new Map();
        for (const cr of credits.filter((x) => String(x.student) === String(a.student?._id))) days.set(dayKey(cr.serviceDate), (days.get(dayKey(cr.serviceDate)) || 0) + cr.minutes);
        const set = new Set([...days].filter(([, m]) => m > 0).map(([d]) => d));
        const dec = [...(c.completionDecisions || [])].reverse().find((d) => String(d.student) === String(a.student?._id));
        rows.push([c.title, `${dayKey(c.startDate)} – ${dayKey(c.endDate)}`, a.student?.name, set.size, missingCampDays({ date: c.startDate, endDate: c.endDate }, set).join(", "), dec ? `${dec.decision}${dec.basis ? ` (basis: ${dec.basis})` : ""}` : "not decided"]);
      }
    }
    return {
      columns: ["Camp", "Dates", "Volunteer", "Verified days", "Missing days", "Completion decision"],
      rows,
      totals: { camps: camps.length, volunteers: rows.length },
      notes: camps.map((c) => `${c.title}: status ${c.status}; closing report ${c.closingReport?.submittedAt ? `submitted${c.closingReport.reviewedAt ? " and reviewed" : ""} — ${String(c.closingReport.summary || "").slice(0, 300)}` : "not submitted"}.`).concat(["Emergency contacts and incident details are excluded from this report."]),
    };
  },
  async periodic({ institution, from, to }) {
    const instId = new mongoose.Types.ObjectId(String(institution));
    const [events, ledger, outcomes, grievancesIn, grievancesResolved, camps] = await Promise.all([
      Event.find({ institution, date: inRange(from, to), status: T({ $ne: "Cancelled" }) }).select("title date type status").lean(),
      LedgerEntry.aggregate([
        { $match: { institution: instId, serviceDate: { $gte: from, $lt: to }, entryType: { $ne: "legacy" }, programme: { $ne: "community_service" } } },
        { $group: { _id: "$kind", minutes: { $sum: "$minutes" }, volunteers: { $addToSet: "$student" } } },
      ]),
      OutcomeRecord.find({ institution, observedAt: inRange(from, to), "verification.status": "verified", level: "reported" }).select("metric unit value").lean(),
      Grievance.countDocuments({ institution, createdAt: inRange(from, to) }),
      Grievance.countDocuments({ institution, "resolution.at": inRange(from, to) }),
      CampPlan.countDocuments({ institution, startDate: inRange(from, to) }),
    ]);
    const k = (x) => ledger.find((l) => l._id === x) || { minutes: 0, volunteers: [] };
    const vols = new Set([...k("regular").volunteers, ...k("camp").volunteers].map(String));
    const out = new Map();
    for (const o of outcomes) {
      const key = `${o.metric}|${o.unit}`;
      out.set(key, (out.get(key) || 0) + o.value);
    }
    return {
      columns: ["Date", "Activity", "Type", "Status"],
      rows: events.map((e) => [dayKey(e.date), e.title, e.type === "special_camp" ? "Special camp" : "Regular", e.status]),
      totals: {
        activities: events.length,
        camps,
        volunteersWithVerifiedService: vols.size,
        verifiedRegularMinutes: k("regular").minutes,
        verifiedCampMinutes: k("camp").minutes,
        complaintsReceived: grievancesIn,
        complaintsResolved: grievancesResolved,
        verifiedOutcomes: [...out].map(([key, v]) => `${key.split("|")[0]}: ${v} ${key.split("|")[1]}`.trim()),
      },
      notes: ["Outcomes listed are supervisor-verified only. Attendance is not reported as impact."],
    };
  },
  async pending_documents({ institution }) {
    const [projects, camps, enrolments] = await Promise.all([
      Project.find({ institution, status: T({ $in: ["draft", "submitted", "approved", "scheduled", "in_progress"] }), "requiredPermissions.status": "pending" }).select("title requiredPermissions").lean(),
      CampPlan.find({ institution, status: T({ $in: ["approved", "in_progress"] }) }).select("title requiredDocuments guardianPermissionRequired applications documents").lean(),
      Enrolment.find({ institution, "guardianPermission.required": true, "guardianPermission.received": false, status: T({ $ne: "withdrawn" }) }).populate("student", "name").lean(),
    ]);
    const rows = [];
    for (const p of projects) for (const r of p.requiredPermissions.filter((x) => x.status === "pending")) rows.push(["Project permission", p.title, r.name, "pending"]);
    for (const c of camps) {
      const need = new Set([...c.requiredDocuments, ...(c.guardianPermissionRequired ? ["guardian_consent"] : [])]);
      const n = await names(c.applications.map((a) => a.student));
      for (const a of c.applications.filter((x) => ["selected", "confirmed"].includes(x.status))) {
        const ok = new Set(c.documents.filter((d) => String(d.student) === String(a.student) && d.status === "verified").map((d) => d.type));
        for (const d of need) if (!ok.has(d)) rows.push(["Camp document", c.title, `${n.get(String(a.student))?.name}: ${d.replace(/_/g, " ")}`, "not verified"]);
      }
    }
    for (const e of enrolments) rows.push(["Guardian permission", `Enrolment ${e.academicYear}`, e.student?.name, "not received"]);
    return { columns: ["Kind", "Record", "Item", "Status"], rows, totals: { pendingItems: rows.length }, notes: ["Document status only; documents themselves are not stored in this system."] };
  },
  async finance_stock({ institution, from, to, financeTotals }) {
    const t = await financeTotals(institution, from, to);
    const items = await StockItem.find({ institution }).sort({ name: 1 }).lean();
    return {
      columns: ["Stock item", "Kind", "Quantity", "Issued out", "Unit"],
      rows: items.map((i) => [i.name, i.kind, i.quantity, i.kind === "equipment" ? i.issuedOut : "", i.unit]),
      totals: { grantsPaise: t.grantsPaise, expensesPaise: t.expensesPaise, advancesIssuedPaise: t.advancesIssuedPaise, advanceReturnsPaise: t.advanceReturnsPaise, expensesByHead: t.expensesByHead, onlineDonationsPaise: t.donations.amountPaise, unverifiedEntries: t.unverifiedEntries },
      notes: ["Amounts in paise. Operational summary for review by the accounts office; not an audited statement."],
    };
  },
  async award_evidence({ institution, from, to }) {
    const entries = await LedgerEntry.find({ institution, serviceDate: inRange(from, to), entryType: T({ $ne: "legacy" }), programme: T({ $ne: "community_service" }) }).lean();
    const by = new Map();
    for (const e of entries) {
      const s = by.get(String(e.student)) || { regular: 0, camp: 0, activities: new Set() };
      s[e.kind] += e.minutes;
      if (e.event) s.activities.add(String(e.event));
      by.set(String(e.student), s);
    }
    const [n, certs, projects] = await Promise.all([
      names([...by.keys()]),
      CompletionCertificate.find({ institution, status: "issued" }).select("student certId").lean(),
      Project.find({ institution }).select("title volunteerTeams").lean(),
    ]);
    const outcomeCount = new Map();
    for (const p of projects) {
      const verified = await OutcomeRecord.countDocuments({ project: p._id, "verification.status": "verified" });
      for (const m of p.volunteerTeams.flatMap((t) => t.members)) outcomeCount.set(String(m), (outcomeCount.get(String(m)) || 0) + verified);
    }
    const rows = [...by]
      .map(([k, s]) => [n.get(k)?.name, h(s.regular), h(s.camp), s.activities.size, outcomeCount.get(k) || 0, certs.filter((c) => String(c.student) === k).map((c) => c.certId).join(", ")])
      .sort((a, b) => b[1] + b[2] - (a[1] + a[2]))
      .slice(0, 50);
    return { columns: ["Volunteer", "Verified regular (h)", "Verified camp (h)", "Activities", "Verified outcomes in their projects", "Issued completion certificates"], rows, totals: { candidates: rows.length }, notes: ["Evidence to support a nomination; selection is an institutional decision."] };
  },
  async handover_pack({ institution, pendingSnapshot }) {
    const s = await pendingSnapshot(institution);
    const rows = [
      ["Diaries awaiting review", s.diariesAwaitingReview],
      ["Diaries returned to volunteers", s.diariesReturned],
      ["Open hours complaints", s.openComplaints],
      ["Attendance awaiting verification", s.attendanceAwaitingVerification],
      ["Completion certificates awaiting review", s.certificatesAwaitingReview],
      ["Draft reconciliations", s.draftReconciliations],
      ...s.outstandingAdvances.map((a) => ["Outstanding advance", `${a.description}: ₹${(a.outstandingPaise / 100).toFixed(2)}`]),
      ...s.equipmentOut.map((e) => ["Equipment issued", `${e.item} × ${e.outstanding} with ${e.holder}`]),
      ...s.openFollowUps.map((f) => ["Project follow-up", `${f.project}: ${f.task}`]),
      ...s.openMeetingActions.map((a) => ["Committee action", `${a.task} (${a.owner || "unassigned"})`]),
      ...s.campsInProgress.map((c) => ["Camp", `${c.title} — ${c.status}`]),
    ];
    return { columns: ["Item", "Detail"], rows, totals: {}, notes: ["Snapshot of pending work at generation time."] };
  },
};

export const buildReport = (type, args) => {
  if (!builders[type]) throw new Error("Unknown report type");
  return builders[type](args);
};
