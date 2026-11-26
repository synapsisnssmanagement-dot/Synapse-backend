// Reports: generated from recorded data into a frozen, checksummed snapshot.
// Every report is a DRAFT until an authorised officer approves it.
import crypto from "crypto";
import PDFDocument from "pdfkit";
import Coordinator from "../models/Coordinator.js";
import Institution from "../models/Institution.js";
import NssUnit from "../models/NssUnit.js";
import { GeneratedReport, ReportTemplate } from "../models/Report.js";
import { activePolicy } from "../utils/ledgerTotals.js";
import { REPORT_TYPES, buildReport } from "../utils/reportBuilders.js";
import { pendingSnapshot, periodTotals } from "./financeController.js";
import { audit, bad, conflict, date, forbid, handle, inst, loadOwn, reasonRequired, requireOfficer, str, T } from "../utils/opsHelpers.js";

const DEFAULT_SIGNATORIES = ["Programme Officer", "Principal / Head of Institution"];
const checksum = (data) => crypto.createHash("sha256").update(JSON.stringify(data)).digest("hex");

export const reportTypes = handle(async (req, res) => {
  requireOfficer(req);
  res.json({ success: true, types: Object.entries(REPORT_TYPES).map(([id, label]) => ({ id, label })) });
});

export const listTemplates = handle(async (req, res) => {
  requireOfficer(req);
  res.json({ success: true, templates: await ReportTemplate.find({ institution: inst(req) }).sort({ type: 1, version: -1 }).lean() });
});
export const createTemplate = handle(async (req, res) => {
  requireOfficer(req);
  const b = req.body || {};
  if (!REPORT_TYPES[b.type]) throw bad("Unknown report type");
  const changeReason = reasonRequired(b.changeReason, "create a template version");
  for (let i = 0; i < 3; i++) {
    const last = await ReportTemplate.findOne({ institution: inst(req), type: b.type }).sort({ version: -1 }).lean();
    try {
      const t = await ReportTemplate.create({
        institution: inst(req), type: b.type, version: (last?.version || 0) + 1, title: str(b.title, 200) || REPORT_TYPES[b.type],
        signatories: (b.signatories || DEFAULT_SIGNATORIES).slice(0, 8).map((s) => str(s, 120)), footerNote: str(b.footerNote, 1000), changeReason, author: req.user._id,
      });
      audit(req, "report_template.create", "ReportTemplate", t._id, { type: t.type, version: t.version });
      return res.status(201).json({ success: true, template: t });
    } catch (e) {
      if (e?.code !== 11000) throw e;
    }
  }
  throw conflict("Please retry");
});
export const activateTemplate = handle(async (req, res) => {
  requireOfficer(req);
  const t = await loadOwn(ReportTemplate, req.params.id, req, "template");
  if (t.status !== "draft") throw conflict("Only a draft can be activated");
  await ReportTemplate.updateMany({ institution: t.institution, type: t.type, status: "active" }, { $set: { status: "retired" } });
  t.status = "active";
  await t.save();
  audit(req, "report_template.activate", "ReportTemplate", t._id, {});
  res.json({ success: true, template: t });
});

export const generateReport = handle(async (req, res) => {
  requireOfficer(req);
  const b = req.body || {};
  if (!REPORT_TYPES[b.type]) throw bad("Unknown report type");
  const from = date(b.from, "period start");
  const to = date(b.to, "period end");
  if (to <= from) throw bad("The period end must be after its start");
  let unit;
  if (b.unit) unit = (await loadOwn(NssUnit, b.unit, req, "unit"))._id;
  const [template, policy] = await Promise.all([ReportTemplate.findOne({ institution: inst(req), type: b.type, status: "active" }).lean(), activePolicy(inst(req), to)]);
  const data = await buildReport(b.type, { institution: inst(req), from, to, unit, financeTotals: periodTotals, pendingSnapshot });
  const r = await GeneratedReport.create({
    institution: inst(req), unit, type: b.type, template: template?._id, templateVersion: template?.version || 0,
    title: template?.title || REPORT_TYPES[b.type], period: { from, to, label: str(b.label, 60) },
    policy: policy ? { _id: policy._id, name: policy.name, version: policy.version } : undefined,
    data, checksum: checksum(data), signatories: template?.signatories?.length ? template.signatories : DEFAULT_SIGNATORIES, generatedBy: req.user._id,
  });
  audit(req, "report.generate", "GeneratedReport", r._id, { type: b.type });
  res.status(201).json({ success: true, report: r });
});

export const listReports = handle(async (req, res) => {
  requireOfficer(req);
  const q = { institution: inst(req) };
  if (req.query.type) q.type = str(req.query.type, 40);
  const reports = await GeneratedReport.find(q).select("-data").sort({ generatedAt: -1 }).limit(200).lean();
  res.json({ success: true, reports });
});
export const getReport = handle(async (req, res) => {
  requireOfficer(req);
  const r = await loadOwn(GeneratedReport, req.params.id, req, "report");
  res.json({ success: true, report: r, intact: checksum(r.data) === r.checksum });
});
export const approveReport = handle(async (req, res) => {
  requireOfficer(req);
  const r = await loadOwn(GeneratedReport, req.params.id, req, "report");
  if (r.status !== "draft") throw conflict(`Report is ${r.status}`);
  if (checksum(r.data) !== r.checksum) throw conflict("Report data does not match its checksum; regenerate it");
  if (String(r.generatedBy) === String(req.user._id) && (await Coordinator.countDocuments({ institution: inst(req), status: "active", _id: T({ $ne: req.user._id }) }))) throw forbid("Another Programme Officer approves a report you generated");
  const u = await GeneratedReport.findOneAndUpdate({ _id: r._id, status: "draft" }, { $set: { status: "approved", approvedBy: req.user._id, approvedAt: new Date() } }, { new: true, projection: "-data" });
  // Earlier approved reports of the same type and period are superseded.
  await GeneratedReport.updateMany({ institution: r.institution, type: r.type, "period.from": r.period.from, "period.to": r.period.to, status: "approved", _id: T({ $ne: r._id }) }, { $set: { status: "superseded" } });
  audit(req, "report.approve", "GeneratedReport", r._id, {});
  res.json({ success: true, report: u });
});

const cell = (v) => {
  const s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s; // spreadsheet formula injection guard
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
const header = async (r) => {
  const [institution, unit] = await Promise.all([Institution.findById(r.institution).select("name").lean(), r.unit ? NssUnit.findById(r.unit).select("code name").lean() : null]);
  return [
    ["Report", r.title],
    ["Status", r.status === "approved" ? `APPROVED ${r.approvedAt?.toISOString()}` : r.status === "draft" ? "DRAFT — not approved" : r.status.toUpperCase()],
    ["Institution", institution?.name || ""],
    ["Unit", unit ? `${unit.code} ${unit.name}` : "All units"],
    ["Period", `${r.period.from.toISOString().slice(0, 10)} to ${r.period.to.toISOString().slice(0, 10)} (end exclusive)`],
    ["Policy", r.policy?.name ? `${r.policy.name} v${r.policy.version}` : "No active policy"],
    ["Template", r.templateVersion ? `v${r.templateVersion}` : "Built-in default (draft template requiring institutional review)"],
    ["Generated", r.generatedAt.toISOString()],
    ["Checksum (sha256)", r.checksum],
  ];
};
export const reportCsv = handle(async (req, res) => {
  requireOfficer(req);
  const r = await loadOwn(GeneratedReport, req.params.id, req, "report");
  const lines = [...(await header(r)), [], r.data.columns, ...r.data.rows, [], ["Totals"], ...Object.entries(r.data.totals || {}).map(([k, v]) => [k, v]), [], ...(r.data.notes || []).map((n) => ["Note", n]), [], ...r.signatories.map((s) => [`${s} (signature)`, ""])];
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${r.type}-${r._id}.csv"`);
  res.send(lines.map((l) => l.map(cell).join(",")).join("\n"));
});
export const reportPdf = handle(async (req, res) => {
  requireOfficer(req);
  const r = await loadOwn(GeneratedReport, req.params.id, req, "report");
  const doc = new PDFDocument({ size: "A4", layout: r.data.columns.length > 5 ? "landscape" : "portrait", margin: 36, bufferPages: true });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${r.type}-${r._id}.pdf"`);
  doc.pipe(res);
  const W = doc.page.width - 72;
  doc.fontSize(16).fillColor("#0a0f1a").text(r.title);
  doc.moveDown(0.3).fontSize(9).fillColor("#334155");
  for (const [k, v] of await header(r)) doc.text(`${k}: ${v}`);
  doc.moveDown(0.6);
  const colW = W / r.data.columns.length;
  const row = (cells, bold) => {
    const y = doc.y;
    const hgt = Math.max(...cells.map((c) => doc.heightOfString(String(c ?? ""), { width: colW - 4 }))) + 4;
    if (y + hgt > doc.page.height - 50) doc.addPage();
    const y0 = doc.y;
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(8);
    cells.forEach((c, i) => doc.text(String(c ?? ""), 36 + i * colW, y0, { width: colW - 4 }));
    doc.y = y0 + hgt;
    doc.x = 36;
  };
  row(r.data.columns, true);
  for (const x of r.data.rows) row(x);
  doc.moveDown(0.8).font("Helvetica-Bold").fontSize(9).text("Totals", 36);
  doc.font("Helvetica");
  for (const [k, v] of Object.entries(r.data.totals || {})) doc.text(`${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`);
  for (const n of r.data.notes || []) doc.moveDown(0.2).fillColor("#64748b").text(n);
  doc.moveDown(1.5).fillColor("#0a0f1a");
  for (const s of r.signatories) doc.text(`______________________________   ${s}`).moveDown(0.8);
  doc.fontSize(7.5).fillColor("#64748b").text("Signature lines are placeholders; this document is not digitally signed.");
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    if (r.status !== "approved") doc.save().fontSize(10).fillColor("#e11d48").text(r.status === "draft" ? "DRAFT — NOT APPROVED" : r.status.toUpperCase(), 36, 14, { lineBreak: false }).restore();
    doc.fontSize(7).fillColor("#94a3b8").text(`Page ${i + 1} of ${range.count}`, 36, doc.page.height - 24, { lineBreak: false });
  }
  doc.end();
});
