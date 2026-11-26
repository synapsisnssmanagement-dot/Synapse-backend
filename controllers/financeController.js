// Finance and registers: grants, advances, expenses, reversals, budgets,
// reconciliation, stock/equipment, committee meetings and officer handover.
// Amounts are integer paise. These are operational records to support the
// institution's accounting; they do not establish accounting or legal compliance.
import mongoose from "mongoose";
import AttendanceRecord from "../models/AttendanceRecord.js";
import Budget from "../models/Budget.js";
import CampPlan from "../models/CampPlan.js";
import CompletionCertificate from "../models/CompletionCertificate.js";
import Coordinator from "../models/Coordinator.js";
import DiaryEntry from "../models/DiaryEntry.js";
import Donation from "../models/Donation.js";
import Event from "../models/Event.js";
import FinanceEntry from "../models/FinanceEntry.js";
import Grievance from "../models/Grievance.js";
import Handover from "../models/Handover.js";
import Meeting from "../models/Meeting.js";
import Project from "../models/Project.js";
import Reconciliation from "../models/Reconciliation.js";
import { StockItem, StockMovement } from "../models/StockItem.js";
import { activePolicy } from "../utils/ledgerTotals.js";
import { academicYearFor, academicYearBounds } from "../utils/serviceRules.js";
import { audit, bad, conflict, date, evidenceList, forbid, handle, inst, int, loadOwn, notFound, oid, reasonRequired, requireOfficer, str, T } from "../utils/opsHelpers.js";

const OP = /^[A-Za-z0-9_-]{8,80}$/;
const opIdOf = (b) => {
  const v = str(b?.opId, 80);
  if (!OP.test(v)) throw bad("opId is required");
  return v;
};
const startMonth = async (institution) => (await activePolicy(institution))?.rules?.academicYearStartMonth || 6;
const otherOfficerExists = async (req) => (await Coordinator.countDocuments({ institution: inst(req), status: "active", _id: T({ $ne: req.user._id }) })) > 0;

// ───── entries
const advanceOutstanding = async (advanceId) => {
  const [adv, settled] = await Promise.all([
    FinanceEntry.findById(advanceId).lean(),
    FinanceEntry.find({ advance: advanceId, kind: T({ $in: ["expense", "advance_return"] }) }).select("_id amountPaise").lean(),
  ]);
  const reversed = new Set((await FinanceEntry.find({ reverses: T({ $in: [advanceId, ...settled.map((s) => s._id)] }) }).select("reverses").lean()).map((r) => String(r.reverses)));
  if (!adv || reversed.has(String(advanceId))) return 0;
  return adv.amountPaise - settled.filter((s) => !reversed.has(String(s._id))).reduce((a, s) => a + s.amountPaise, 0);
};

export const createEntry = handle(async (req, res) => {
  requireOfficer(req);
  const b = req.body || {};
  const opId = opIdOf(b);
  const existing = await FinanceEntry.findOne({ opId }).lean();
  if (existing) return res.json({ success: true, entry: existing, duplicate: true });
  if (!["grant", "advance", "advance_return", "expense", "reversal"].includes(b.kind)) throw bad("Invalid entry kind");
  const when = date(b.date || new Date(), "date");
  const doc = {
    institution: inst(req), kind: b.kind, date: when, academicYear: academicYearFor(when, await startMonth(inst(req))),
    head: str(b.head, 80) || "general", description: str(b.description, 1000), mode: ["bank", "cash", "upi", "cheque", "other"].includes(b.mode) ? b.mode : "bank",
    source: str(b.source, 200), reference: str(b.reference, 200), receipts: evidenceList(b.receipts), recordedBy: req.user._id, opId,
  };
  if (b.kind === "reversal") {
    const orig = await loadOwn(FinanceEntry, b.reverses, req, "entry");
    if (orig.kind === "reversal") throw bad("A reversal cannot be reversed; record a new entry instead");
    doc.reverses = orig._id;
    doc.amountPaise = orig.amountPaise;
    // A reversal corrects the period of the entry it cancels unless dated explicitly.
    if (!b.date) {
      doc.date = orig.date;
      doc.academicYear = orig.academicYear;
    }
    doc.head = orig.head;
    doc.description = `Reversal: ${reasonRequired(b.reason || b.description, "reverse an entry")}`;
  } else {
    doc.amountPaise = int(b.amountPaise, "Amount (paise)", { min: 1, max: 1e11 });
    if (!doc.description) throw bad("Describe the entry");
  }
  if (b.camp) doc.camp = (await loadOwn(CampPlan, b.camp, req, "camp"))._id;
  if (b.project) doc.project = (await loadOwn(Project, b.project, req, "project"))._id;
  if (b.kind === "advance") {
    doc.holder = oid(b.holder, "advance holder");
  }
  if (["expense", "advance_return"].includes(b.kind) && b.advance) {
    const adv = await loadOwn(FinanceEntry, b.advance, req, "advance");
    if (adv.kind !== "advance") throw bad("Settle against an advance entry");
    if ((await advanceOutstanding(adv._id)) < doc.amountPaise) throw bad("Amount exceeds the advance still outstanding");
    doc.advance = adv._id;
    doc.holder = adv.holder;
  } else if (b.kind === "advance_return") throw bad("An advance return must reference the advance");
  if (b.kind === "expense" && !doc.reference && !doc.receipts.length) throw bad("Record a voucher/receipt number or link for an expense");
  try {
    const entry = await FinanceEntry.create(doc);
    audit(req, `finance.${b.kind}`, "FinanceEntry", entry._id, { amountPaise: entry.amountPaise, head: entry.head, reverses: doc.reverses });
    res.status(201).json({ success: true, entry });
  } catch (e) {
    if (e?.code === 11000) {
      if (doc.reverses) throw conflict("This entry has already been reversed");
      return res.json({ success: true, entry: await FinanceEntry.findOne({ opId }).lean(), duplicate: true });
    }
    throw e;
  }
});

export const verifyEntry = handle(async (req, res) => {
  requireOfficer(req);
  const e = await loadOwn(FinanceEntry, req.params.id, req, "entry");
  if (String(e.recordedBy) === String(req.user._id) && (await otherOfficerExists(req))) throw forbid("Another Programme Officer verifies entries you recorded");
  const u = await FinanceEntry.findOneAndUpdate({ _id: e._id, status: "recorded" }, { $set: { status: "verified", verifiedBy: req.user._id, verifiedAt: new Date() } }, { new: true });
  if (!u) throw conflict("Already verified");
  audit(req, "finance.verify", "FinanceEntry", e._id, {});
  res.json({ success: true, entry: u });
});

export const listEntries = handle(async (req, res) => {
  requireOfficer(req);
  const q = { institution: inst(req) };
  if (req.query.kind) q.kind = str(req.query.kind, 20);
  if (req.query.head) q.head = str(req.query.head, 80);
  if (req.query.from || req.query.to) q.date = T({ ...(req.query.from ? { $gte: date(req.query.from, "from") } : {}), ...(req.query.to ? { $lte: date(req.query.to, "to") } : {}) });
  const page = Math.max(1, Number(req.query.page) || 1);
  const [entries, total] = await Promise.all([FinanceEntry.find(q).sort({ date: -1, createdAt: -1 }).skip((page - 1) * 100).limit(100).lean(), FinanceEntry.countDocuments(q)]);
  res.json({ success: true, entries, total, page });
});

// ───── summaries
export const periodTotals = async (institution, from, to) => {
  const entries = await FinanceEntry.find({ institution, date: T({ $gte: from, $lt: to }) }).lean();
  const reversed = new Set(entries.filter((e) => e.kind === "reversal").map((e) => String(e.reverses)));
  // Reversals of entries from earlier periods still count in this period.
  const priorReversed = entries.filter((e) => e.kind === "reversal" && !entries.some((x) => String(x._id) === String(e.reverses)));
  const prior = priorReversed.length ? await FinanceEntry.find({ _id: T({ $in: priorReversed.map((e) => e.reverses) }) }).lean() : [];
  const live = entries.filter((e) => e.kind !== "reversal" && !reversed.has(String(e._id)));
  const sum = (k) => live.filter((e) => e.kind === k).reduce((a, e) => a + e.amountPaise, 0);
  const priorAdj = (k) => prior.filter((e) => e.kind === k).reduce((a, e) => a + e.amountPaise, 0);
  const byHead = {};
  for (const e of live.filter((e) => e.kind === "expense")) byHead[e.head] = (byHead[e.head] || 0) + e.amountPaise;
  for (const e of prior.filter((e) => e.kind === "expense")) byHead[e.head] = (byHead[e.head] || 0) - e.amountPaise;
  const events = await Event.find({ institution }).select("_id").lean();
  const don = await Donation.aggregate([
    { $match: { eventId: { $in: events.map((e) => e._id) }, status: "succeeded", createdAt: { $gte: from, $lt: to } } },
    { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } },
  ]);
  return {
    grantsPaise: sum("grant") - priorAdj("grant"),
    expensesPaise: sum("expense") - priorAdj("expense"),
    advancesIssuedPaise: sum("advance") - priorAdj("advance"),
    advanceReturnsPaise: sum("advance_return") - priorAdj("advance_return"),
    expensesByHead: byHead,
    donations: { amountPaise: Math.round((don[0]?.total || 0) * 100), count: don[0]?.count || 0, note: "Online donations as recorded by the payment integration; read-only here." },
    unverifiedEntries: live.filter((e) => e.status !== "verified").length,
  };
};

export const financeSummary = handle(async (req, res) => {
  requireOfficer(req);
  const sm = await startMonth(inst(req));
  const year = req.query.academicYear ? int(req.query.academicYear, "academicYear", { min: 2000, max: 2100 }) : academicYearFor(new Date(), sm);
  const { start, end } = academicYearBounds(year, sm);
  const [totals, budgets, advances] = await Promise.all([
    periodTotals(inst(req), start, end),
    Budget.find({ institution: inst(req), academicYear: year }).lean(),
    FinanceEntry.find({ institution: inst(req), kind: "advance" }).select("_id amountPaise holder description date").lean(),
  ]);
  const outstanding = [];
  for (const a of advances) {
    const left = await advanceOutstanding(a._id);
    if (left > 0) outstanding.push({ ...a, outstandingPaise: left });
  }
  const heads = new Set([...budgets.map((b) => b.head), ...Object.keys(totals.expensesByHead)]);
  res.json({
    success: true,
    academicYear: year,
    period: { from: start, to: end },
    ...totals,
    advancesOutstanding: outstanding,
    budgetVsActual: [...heads].map((h) => ({ head: h, budgetPaise: budgets.find((b) => b.head === h)?.amountPaise || 0, spentPaise: totals.expensesByHead[h] || 0 })),
    // Cash position from the register only: grants − expenses − advances issued + advance returns.
    registerBalancePaise: totals.grantsPaise - totals.expensesPaise - totals.advancesIssuedPaise + totals.advanceReturnsPaise,
  });
});

// Draft utilisation statement for authorised review (not an audited statement).
export const utilisationDraft = handle(async (req, res) => {
  requireOfficer(req);
  const sm = await startMonth(inst(req));
  const year = int(req.query.academicYear ?? academicYearFor(new Date(), sm), "academicYear", { min: 2000, max: 2100 });
  const { start, end } = academicYearBounds(year, sm);
  const t = await periodTotals(inst(req), start, end);
  const grants = await FinanceEntry.find({ institution: inst(req), kind: "grant", date: T({ $gte: start, $lt: end }) }).select("amountPaise source reference date status").lean();
  res.json({
    success: true,
    status: "DRAFT — for authorised review; not an audited or certified statement",
    academicYear: year,
    period: { from: start, to: end },
    grantsReceived: grants,
    totalReceivedPaise: t.grantsPaise,
    expenditureByHead: t.expensesByHead,
    totalExpenditurePaise: t.expensesPaise,
    unspentPaise: t.grantsPaise - t.expensesPaise,
    unverifiedEntries: t.unverifiedEntries,
    signatories: ["Programme Officer", "Principal / Head of Institution", "Accounts / Finance Officer"],
    generatedAt: new Date(),
  });
});

// ───── budgets
export const listBudgets = handle(async (req, res) => {
  requireOfficer(req);
  const q = { institution: inst(req) };
  if (req.query.academicYear) q.academicYear = int(req.query.academicYear, "academicYear", { min: 2000, max: 2100 });
  res.json({ success: true, budgets: await Budget.find(q).sort({ academicYear: -1, head: 1 }).lean() });
});
export const setBudget = handle(async (req, res) => {
  requireOfficer(req);
  const b = req.body || {};
  const academicYear = int(b.academicYear, "academicYear", { min: 2000, max: 2100 });
  const head = str(b.head, 80);
  if (!head) throw bad("Budget head is required");
  const amountPaise = int(b.amountPaise, "Amount (paise)", { min: 0, max: 1e11 });
  const reason = reasonRequired(b.reason, "set a budget");
  const budget = await Budget.findOneAndUpdate(
    { institution: inst(req), academicYear, head },
    { $set: { amountPaise, note: str(b.note, 500) }, $push: { history: { amountPaise, by: req.user._id, reason } } },
    { new: true, upsert: true }
  );
  audit(req, "finance.budget", "Budget", budget._id, { academicYear, head, amountPaise, reason });
  res.json({ success: true, budget });
});

// ───── reconciliation
export const createReconciliation = handle(async (req, res) => {
  requireOfficer(req);
  const b = req.body || {};
  const from = date(b.from, "from");
  const to = date(b.to, "to");
  if (to <= from) throw bad("Invalid period");
  const statementBalancePaise = int(b.statementBalancePaise, "Statement balance (paise)", { min: -1e11, max: 1e11 });
  const openingBalancePaise = int(b.openingBalancePaise ?? 0, "Opening balance (paise)", { min: -1e11, max: 1e11 });
  const t = await periodTotals(inst(req), from, to);
  const computed = openingBalancePaise + t.grantsPaise - t.expensesPaise - t.advancesIssuedPaise + t.advanceReturnsPaise;
  const rec = await Reconciliation.create({
    institution: inst(req), from, to, statementBalancePaise,
    snapshot: { ...t, openingBalancePaise, computedClosingPaise: computed, computedAt: new Date() },
    differencePaise: statementBalancePaise - computed,
    explanation: str(b.explanation, 2000),
    preparedBy: req.user._id,
  });
  audit(req, "finance.reconciliation.create", "Reconciliation", rec._id, { difference: rec.differencePaise });
  res.status(201).json({ success: true, reconciliation: rec });
});
export const approveReconciliation = handle(async (req, res) => {
  requireOfficer(req);
  const rec = await loadOwn(Reconciliation, req.params.id, req, "reconciliation");
  if (rec.status !== "draft") throw conflict("Already approved");
  if (String(rec.preparedBy) === String(req.user._id) && (await otherOfficerExists(req))) throw forbid("Another Programme Officer approves a reconciliation you prepared");
  if (rec.differencePaise !== 0 && str(req.body?.explanation || rec.explanation, 2000).length < 10) throw bad("Explain the difference before approving");
  const u = await Reconciliation.findOneAndUpdate({ _id: rec._id, status: "draft" }, { $set: { status: "approved", approvedBy: req.user._id, approvedAt: new Date(), explanation: str(req.body?.explanation || rec.explanation, 2000) } }, { new: true });
  audit(req, "finance.reconciliation.approve", "Reconciliation", rec._id, {});
  res.json({ success: true, reconciliation: u });
});
export const listReconciliations = handle(async (req, res) => {
  requireOfficer(req);
  res.json({ success: true, reconciliations: await Reconciliation.find({ institution: inst(req) }).sort({ to: -1 }).lean() });
});

// ───── stock & equipment
export const listStock = handle(async (req, res) => {
  requireOfficer(req);
  const [items, issued] = await Promise.all([
    StockItem.find({ institution: inst(req) }).sort({ name: 1 }).lean(),
    StockMovement.find({ institution: inst(req), type: "issue" }).populate("item", "name unit").sort({ createdAt: -1 }).limit(500).lean(),
  ]);
  const returned = await StockMovement.aggregate([{ $match: { institution: new mongoose.Types.ObjectId(String(inst(req))), type: "return" } }, { $group: { _id: "$issue", q: { $sum: "$quantity" } } }]);
  const back = new Map(returned.map((r) => [String(r._id), r.q]));
  res.json({ success: true, items, outstandingIssues: issued.map((i) => ({ ...i, outstanding: i.quantity - (back.get(String(i._id)) || 0) })).filter((i) => i.outstanding > 0) });
});
export const createStockItem = handle(async (req, res) => {
  requireOfficer(req);
  const b = req.body || {};
  if (!["consumable", "equipment"].includes(b.kind)) throw bad("Kind must be consumable or equipment");
  const item = await StockItem.create({ institution: inst(req), name: str(b.name, 120), kind: b.kind, unit: str(b.unit, 30) || "nos", location: str(b.location, 120) });
  res.status(201).json({ success: true, item });
});
export const stockMovement = handle(async (req, res) => {
  requireOfficer(req);
  const b = req.body || {};
  const opId = opIdOf(b);
  const dup = await StockMovement.findOne({ opId }).lean();
  if (dup) return res.json({ success: true, movement: dup, duplicate: true });
  const item = await loadOwn(StockItem, b.item, req, "item");
  const type = b.type;
  if (!["receive", "consume", "issue", "return", "write_off"].includes(type)) throw bad("Invalid movement");
  const q = Number(b.quantity);
  if (!Number.isFinite(q) || q <= 0 || q > 1e7) throw bad("Quantity must be positive");
  if (item.kind === "equipment" && !Number.isInteger(q)) throw bad("Equipment is counted in whole units");
  if (["issue", "return"].includes(type) && item.kind !== "equipment") throw bad("Only equipment is issued and returned; consumables are consumed");
  if (type === "consume" && item.kind !== "consumable") throw bad("Equipment is issued, not consumed");
  const doc = { institution: inst(req), item: item._id, type, quantity: q, reference: str(b.reference, 200), reason: str(b.reason, 500), by: req.user._id, opId };
  if (type === "write_off") doc.reason = reasonRequired(b.reason, "write off stock");
  if (type === "issue") {
    doc.holderName = str(b.holderName, 120);
    if (!doc.holderName) throw bad("Who is the equipment issued to?");
    if (b.dueBack) doc.dueBack = date(b.dueBack, "due date");
  }
  if (type === "return") {
    const issue = await StockMovement.findOne({ _id: oid(b.issue, "issue"), item: item._id, type: "issue" }).lean();
    if (!issue) throw bad("Return must reference the issue");
    const back = await StockMovement.aggregate([{ $match: { issue: issue._id, type: "return" } }, { $group: { _id: null, q: { $sum: "$quantity" } } }]);
    if ((back[0]?.q || 0) + q > issue.quantity) throw bad("Returning more than was issued");
    doc.issue = issue._id;
    doc.holderName = issue.holderName;
  }
  if (b.camp) doc.camp = (await loadOwn(CampPlan, b.camp, req, "camp"))._id;
  if (b.project) doc.project = (await loadOwn(Project, b.project, req, "project"))._id;
  let movement;
  try {
    movement = await StockMovement.create(doc);
  } catch (e) {
    if (e?.code === 11000) return res.json({ success: true, movement: await StockMovement.findOne({ opId }).lean(), duplicate: true });
    throw e;
  }
  // Conditional atomic update; never below zero, never issue more than on hand.
  const filters = {
    receive: [{}, { $inc: { quantity: q } }],
    consume: [{ quantity: T({ $gte: q }) }, { $inc: { quantity: -q } }],
    write_off: [{ $expr: T({ $gte: [{ $subtract: ["$quantity", "$issuedOut"] }, q] }) }, { $inc: { quantity: -q } }],
    issue: [{ $expr: T({ $gte: [{ $subtract: ["$quantity", "$issuedOut"] }, q] }) }, { $inc: { issuedOut: q } }],
    return: [{ issuedOut: T({ $gte: q }) }, { $inc: { issuedOut: -q } }],
  }[type];
  const updated = await StockItem.findOneAndUpdate({ _id: item._id, ...filters[0] }, filters[1], { new: true });
  if (!updated) {
    await StockMovement.deleteOne({ _id: movement._id });
    throw bad("Not enough stock on hand");
  }
  audit(req, `stock.${type}`, "StockItem", item._id, { quantity: q });
  res.status(201).json({ success: true, movement, item: updated });
});

// ───── meetings
export const listMeetings = handle(async (req, res) => {
  requireOfficer(req);
  res.json({ success: true, meetings: await Meeting.find({ institution: inst(req) }).sort({ date: -1 }).limit(200).lean() });
});
const meetingFields = (b) => ({
  kind: ["advisory_committee", "unit_meeting", "other"].includes(b.kind) ? b.kind : "advisory_committee",
  date: date(b.date, "meeting date"),
  attendees: (b.attendees || []).slice(0, 60).map((a) => ({ name: str(a.name, 120), role: str(a.role, 120) })),
  agenda: str(b.agenda, 4000),
  minutes: str(b.minutes, 20000),
  decisions: (b.decisions || []).slice(0, 60).map((d) => ({ text: str(d.text ?? d, 1000) })),
  actionItems: (b.actionItems || []).slice(0, 60).map((a) => ({ task: str(a.task, 500), owner: str(a.owner, 120), due: a.due ? date(a.due, "due") : undefined, status: a.status === "done" ? "done" : "open" })),
});
export const saveMeeting = handle(async (req, res) => {
  requireOfficer(req);
  if (req.params.id) {
    const m = await loadOwn(Meeting, req.params.id, req, "meeting");
    if (m.status === "approved") {
      // Only action-item status may change after approval.
      const items = (req.body?.actionItems || []).map((a, i) => ({ ...m.actionItems[i]?.toObject(), status: a.status === "done" ? "done" : "open" }));
      if (Object.keys(req.body || {}).some((k) => k !== "actionItems")) throw conflict("Approved minutes are locked");
      m.actionItems = items.slice(0, m.actionItems.length);
      await m.save();
      return res.json({ success: true, meeting: m });
    }
    Object.assign(m, meetingFields({ ...m.toObject(), ...req.body }));
    await m.save();
    return res.json({ success: true, meeting: m });
  }
  const m = await Meeting.create({ institution: inst(req), ...meetingFields(req.body || {}), recordedBy: req.user._id });
  res.status(201).json({ success: true, meeting: m });
});
export const approveMeeting = handle(async (req, res) => {
  requireOfficer(req);
  const m = await loadOwn(Meeting, req.params.id, req, "meeting");
  if (!m.minutes || m.minutes.length < 10) throw bad("Write the minutes before approving");
  const u = await Meeting.findOneAndUpdate({ _id: m._id, status: "draft" }, { $set: { status: "approved", approvedBy: req.user._id, approvedAt: new Date() } }, { new: true });
  if (!u) throw conflict("Already approved");
  audit(req, "meeting.approve", "Meeting", m._id, {});
  res.json({ success: true, meeting: u });
});

// ───── handover
export const pendingSnapshot = async (institution) => {
  const [submitted, returned, grievances, advances, issues, followUps, recon, certs, camps, unverified, meetings] = await Promise.all([
    DiaryEntry.countDocuments({ institution, status: "submitted" }),
    DiaryEntry.countDocuments({ institution, status: "returned" }),
    Grievance.find({ institution, status: T({ $in: ["open", "under_review", "escalated"] }) }).select("type deadline").lean(),
    FinanceEntry.find({ institution, kind: "advance" }).select("_id amountPaise description").lean(),
    StockMovement.find({ institution, type: "issue" }).populate("item", "name").select("item quantity holderName dueBack").lean(),
    Project.find({ institution, "followUps.status": "open" }).select("title followUps").lean(),
    Reconciliation.countDocuments({ institution, status: "draft" }),
    CompletionCertificate.countDocuments({ institution, status: "pending_review" }),
    CampPlan.find({ institution, status: T({ $in: ["submitted", "approved", "in_progress", "completed"] }) }).select("title status").lean(),
    AttendanceRecord.countDocuments({ institution, verification: T({ $in: ["unverified", "disputed"] }) }),
    Meeting.find({ institution, "actionItems.status": "open" }).select("date actionItems").lean(),
  ]);
  const outstandingAdvances = [];
  for (const a of advances) {
    const left = await advanceOutstanding(a._id);
    if (left > 0) outstandingAdvances.push({ description: a.description, outstandingPaise: left });
  }
  const back = await StockMovement.aggregate([{ $match: { institution: new mongoose.Types.ObjectId(String(institution)), type: "return" } }, { $group: { _id: "$issue", q: { $sum: "$quantity" } } }]);
  const backMap = new Map(back.map((r) => [String(r._id), r.q]));
  return {
    computedAt: new Date(),
    diariesAwaitingReview: submitted,
    diariesReturned: returned,
    openComplaints: grievances.length,
    outstandingAdvances,
    equipmentOut: issues.map((i) => ({ item: i.item?.name, holder: i.holderName, outstanding: i.quantity - (backMap.get(String(i._id)) || 0), dueBack: i.dueBack })).filter((i) => i.outstanding > 0),
    openFollowUps: followUps.flatMap((p) => p.followUps.filter((f) => f.status === "open").map((f) => ({ project: p.title, task: f.task, due: f.due }))),
    draftReconciliations: recon,
    certificatesAwaitingReview: certs,
    campsInProgress: camps,
    attendanceAwaitingVerification: unverified,
    openMeetingActions: meetings.flatMap((m) => m.actionItems.filter((a) => a.status === "open").map((a) => ({ meeting: m.date, task: a.task, owner: a.owner }))),
  };
};
export const createHandover = handle(async (req, res) => {
  requireOfficer(req);
  const b = req.body || {};
  const to = await Coordinator.findOne({ _id: oid(b.toOfficer, "incoming officer"), institution: inst(req) }).lean();
  if (!to) throw notFound("Incoming officer not found in your institution");
  if (String(to._id) === String(req.user._id)) throw bad("Hand over to a different officer");
  const h = await Handover.create({
    institution: inst(req), fromOfficer: req.user._id, toOfficer: to._id, effectiveDate: date(b.effectiveDate, "effective date"),
    notes: str(b.notes, 8000), checklist: (b.checklist || []).slice(0, 60).map((c) => ({ item: str(c.item ?? c, 300), done: Boolean(c.done) })),
    snapshot: await pendingSnapshot(inst(req)),
  });
  audit(req, "handover.create", "Handover", h._id, { to: to._id });
  res.status(201).json({ success: true, handover: h });
});
export const acknowledgeHandover = handle(async (req, res) => {
  requireOfficer(req);
  const h = await loadOwn(Handover, req.params.id, req, "handover");
  if (String(h.toOfficer) !== String(req.user._id)) throw forbid("Only the incoming officer acknowledges a handover");
  const u = await Handover.findOneAndUpdate({ _id: h._id, status: "prepared" }, { $set: { status: "acknowledged", acknowledgedAt: new Date(), acknowledgementNote: str(req.body?.note, 2000) } }, { new: true });
  if (!u) throw conflict("Already acknowledged");
  audit(req, "handover.acknowledge", "Handover", h._id, {});
  res.json({ success: true, handover: u });
});
export const listHandovers = handle(async (req, res) => {
  requireOfficer(req);
  res.json({ success: true, handovers: await Handover.find({ institution: inst(req) }).populate("fromOfficer toOfficer", "name").sort({ createdAt: -1 }).lean() });
});
