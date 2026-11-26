// NSS completion certificates: prepare from a ledger evaluation snapshot,
// independent review, issue, revoke, reissue. Event participation
// certificates (models/Certificate.js) stay separate; officers can revoke them.
import crypto from "crypto";
import PDFDocument from "pdfkit";
import Certificate from "../models/Certificate.js";
import CompletionCertificate from "../models/CompletionCertificate.js";
import Coordinator from "../models/Coordinator.js";
import Institution from "../models/Institution.js";
import LedgerEntry from "../models/LedgerEntry.js";
import Recalculation from "../models/Recalculation.js";
import ServicePolicy from "../models/ServicePolicy.js";
import Student from "../models/Student.js";
import { evaluatePolicy, summariseLedger, yearLabel } from "../utils/serviceRules.js";
import { audit, bad, conflict, forbid, handle, inst, loadOwn, notFound, oid, reasonRequired, requireActive, requireOfficer, str, T } from "../utils/opsHelpers.js";

const TITLE = {
  national: "Certificate of NSS Service Completion",
  local_academic: "Institutional Service Completion Record",
  benefit: "Service Benefit Eligibility Record",
};

const evaluate = async (studentId, policy) => {
  const entries = await LedgerEntry.find({ student: studentId }).lean();
  const legacyByYear = {};
  for (const e of entries) if (e.entryType === "legacy") legacyByYear[e.academicYear] = (legacyByYear[e.academicYear] || 0) + e.minutes;
  const summary = summariseLedger(entries, policy.rules.academicYearStartMonth);
  return {
    summary: { verifiedRegular: summary.verifiedRegular, verifiedCamp: summary.verifiedCamp, legacy: summary.legacy, byYear: summary.byYear, byCategory: summary.byCategory },
    evaluation: evaluatePolicy(summary, policy.rules, { legacyByYear }),
    ledgerEntryCount: entries.length,
    evaluatedAt: new Date(),
  };
};

// Preview eligibility for a student under any policy version (no write).
export const previewCertificate = handle(async (req, res) => {
  requireOfficer(req);
  const student = await loadOwn(Student, req.query.student, req, "volunteer");
  const policy = await loadOwn(ServicePolicy, req.query.policy, req, "policy");
  res.json({ success: true, student: { _id: student._id, name: student.name }, policy: { _id: policy._id, name: policy.name, version: policy.version, status: policy.status }, ...(await evaluate(student._id, policy)) });
});

export const prepareCertificate = handle(async (req, res) => {
  requireOfficer(req);
  const b = req.body || {};
  const student = await loadOwn(Student, b.student, req, "volunteer");
  const policy = await loadOwn(ServicePolicy, b.policy, req, "policy");
  if (policy.status !== "active") throw bad("Certificates are prepared against an active policy");
  const snap = await evaluate(student._id, policy);
  let exception;
  if (!snap.evaluation.met) {
    if (!b.exception) throw bad("Requirements are not met. An exception needs a recorded reason and policy basis.");
    exception = { granted: true, reason: reasonRequired(b.exception.reason, "grant an exception"), basis: reasonRequired(b.exception.basis, "state the policy basis for an exception") };
  }
  try {
    const cert = await CompletionCertificate.create({
      certId: `NSSC-${crypto.randomBytes(6).toString("hex").toUpperCase()}`,
      institution: inst(req),
      student: student._id,
      studentName: student.name,
      policy: policy._id,
      policyVersion: policy.version,
      policyName: policy.name,
      requirementType: policy.requirementType,
      snapshot: snap,
      exception,
      preparedBy: req.user._id,
      signatories: (policy.rules.reportSignatories || []).map((role) => ({ role, name: "" })),
      history: [{ action: "prepared", by: req.user._id, reason: exception ? `Exception: ${exception.reason}` : "Requirements met" }],
    });
    audit(req, "certificate.prepare", "CompletionCertificate", cert._id, { policyVersion: policy.version, exception: Boolean(exception) });
    res.status(201).json({ success: true, certificate: cert });
  } catch (e) {
    if (e?.code === 11000) throw conflict("A pending or issued certificate already exists for this volunteer under this policy");
    throw e;
  }
});

// Review by a second Programme Officer where one exists.
export const reviewCertificate = handle(async (req, res) => {
  requireOfficer(req);
  const action = req.body?.action;
  if (!["issue", "reject"].includes(action)) throw bad("Action must be issue or reject");
  const cert = await loadOwn(CompletionCertificate, req.params.id, req, "certificate");
  if (cert.status !== "pending_review") throw conflict(`Certificate is ${cert.status}`);
  if (String(cert.preparedBy) === String(req.user._id)) {
    const others = await Coordinator.countDocuments({ institution: inst(req), status: "active", _id: T({ $ne: req.user._id }) });
    if (others > 0) throw forbid("Another Programme Officer must review a certificate you prepared");
  }
  const reason = action === "reject" ? reasonRequired(req.body?.reason, "reject a certificate") : str(req.body?.reason, 500) || "Reviewed and issued";
  const set = action === "issue" ? { status: "issued", issuedAt: new Date(), reviewedBy: req.user._id } : { status: "rejected", reviewedBy: req.user._id };
  const updated = await CompletionCertificate.findOneAndUpdate(
    { _id: cert._id, status: "pending_review", rev: cert.rev },
    { $set: set, $inc: { rev: 1 }, $push: { history: { action: action === "issue" ? "issued" : "rejected", by: req.user._id, reason } } },
    { new: true }
  );
  if (!updated) throw conflict("The certificate changed meanwhile");
  audit(req, `certificate.${action}`, "CompletionCertificate", cert._id, { reason });
  res.json({ success: true, certificate: updated });
});

export const revokeCertificate = handle(async (req, res) => {
  requireOfficer(req);
  const reason = reasonRequired(req.body?.reason, "revoke a certificate");
  const cert = await loadOwn(CompletionCertificate, req.params.id, req, "certificate");
  const updated = await CompletionCertificate.findOneAndUpdate(
    { _id: cert._id, status: "issued" },
    { $set: { status: "revoked" }, $inc: { rev: 1 }, $push: { history: { action: "revoked", by: req.user._id, reason } } },
    { new: true }
  );
  if (!updated) throw conflict("Only an issued certificate can be revoked");
  audit(req, "certificate.revoke", "CompletionCertificate", cert._id, { reason });
  res.json({ success: true, certificate: updated });
});

// Reissue: new record (fresh snapshot, pending review); original marked superseded.
export const reissueCertificate = handle(async (req, res) => {
  requireOfficer(req);
  const reason = reasonRequired(req.body?.reason, "reissue a certificate");
  const orig = await loadOwn(CompletionCertificate, req.params.id, req, "certificate");
  if (!["issued", "revoked"].includes(orig.status)) throw conflict("Only issued or revoked certificates can be reissued");
  const policy = await ServicePolicy.findById(orig.policy).lean();
  const snap = await evaluate(orig.student, policy);
  const marked = await CompletionCertificate.findOneAndUpdate(
    { _id: orig._id, status: orig.status, rev: orig.rev },
    { $set: { status: "superseded" }, $inc: { rev: 1 }, $push: { history: { action: "superseded", by: req.user._id, reason } } },
    { new: true }
  );
  if (!marked) throw conflict("The certificate changed meanwhile");
  const next = await CompletionCertificate.create({
    ...orig.toObject({ depopulate: true }),
    _id: undefined,
    certId: `NSSC-${crypto.randomBytes(6).toString("hex").toUpperCase()}`,
    status: "pending_review",
    rev: 0,
    snapshot: snap,
    supersedes: orig._id,
    supersededBy: undefined,
    reviewedBy: undefined,
    issuedAt: undefined,
    preparedBy: req.user._id,
    history: [{ action: "prepared (reissue)", by: req.user._id, reason }],
    createdAt: undefined,
    updatedAt: undefined,
  });
  await CompletionCertificate.updateOne({ _id: orig._id }, { $set: { supersededBy: next._id } });
  audit(req, "certificate.reissue", "CompletionCertificate", orig._id, { next: next._id, reason });
  res.status(201).json({ success: true, certificate: next });
});

export const listCertificates = handle(async (req, res) => {
  requireActive(req);
  const q = { institution: inst(req) };
  if (req.student) q.student = req.user._id;
  else if (!req.coordinator) throw forbid();
  if (req.query.status) q.status = str(req.query.status, 20);
  const certificates = await CompletionCertificate.find(q).populate("student", "name department").sort({ updatedAt: -1 }).limit(300).lean();
  res.json({ success: true, certificates });
});

// Printable PDF. Not issued → "DRAFT" watermark. Signature lines are
// placeholders: this PDF is not a digitally signed document.
export const certificatePdf = handle(async (req, res) => {
  requireActive(req);
  const cert = await loadOwn(CompletionCertificate, req.params.id, req, "certificate");
  if (req.student && String(cert.student) !== String(req.user._id)) throw notFound("Certificate not found");
  if (!req.student && !req.coordinator) throw forbid();
  const institution = await Institution.findById(cert.institution).select("name address").lean();
  const ev = cert.snapshot?.evaluation || {};
  const doc = new PDFDocument({ size: "A4", margin: 56 });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${cert.certId}.pdf"`);
  doc.pipe(res);
  if (cert.status !== "issued") {
    doc.save().rotate(-30, { origin: [300, 420] }).fontSize(70).fillColor("#e11d48").opacity(0.15).text(cert.status === "pending_review" ? "DRAFT — NOT ISSUED" : cert.status.toUpperCase(), 40, 380).restore();
    doc.opacity(1);
  }
  doc.fillColor("#047857").fontSize(10).text((institution?.name || "").toUpperCase(), { characterSpacing: 1.2 });
  doc.moveDown(1.5).fillColor("#0a0f1a").fontSize(24).text(TITLE[cert.requirementType]);
  doc.moveDown(1).fontSize(12).fillColor("#334155").text("This records that");
  doc.moveDown(0.3).fontSize(20).fillColor("#0a0f1a").text(cert.studentName);
  doc.moveDown(0.6).fontSize(12).fillColor("#334155").text(
    `completed the service requirements of "${cert.policyName}" (version ${cert.policyVersion}) as configured by the institution, based on supervisor-approved service records.`
  );
  doc.moveDown(1);
  for (const y of ev.years || []) doc.text(`• ${y.label}: ${Math.round(y.minutes / 6) / 10} hours of regular service`);
  if (ev.camp?.required) doc.text(`• Special camp (${ev.camp.requiredDays} days): ${ev.camp.met ? "completed" : "not completed"}`);
  if (cert.exception?.granted) doc.moveDown(0.5).text(`Exception recorded: ${cert.exception.reason} (basis: ${cert.exception.basis})`);
  doc.moveDown(2);
  const sigs = cert.signatories?.length ? cert.signatories : [{ role: "Programme Officer" }, { role: "Principal / Head of Institution" }];
  for (const s of sigs) doc.text(`______________________________   ${s.role}${s.name ? ` — ${s.name}` : ""}`).moveDown(1);
  doc.moveDown(1).fontSize(9).fillColor("#64748b").text(
    `Certificate ID ${cert.certId} · Status: ${cert.status}${cert.issuedAt ? ` · Issued ${cert.issuedAt.toISOString().slice(0, 10)}` : ""} · Generated ${new Date().toISOString()}. ` +
      "Verify at /verify/<ID>. Signature lines are placeholders; this document is not digitally signed. Validity is confirmed only by the online verification record."
  );
  doc.end();
});

// Officers can revoke event participation certificates; the record stays.
export const revokeEventCertificate = handle(async (req, res) => {
  requireOfficer(req);
  const reason = reasonRequired(req.body?.reason, "revoke a certificate");
  const cert = await Certificate.findOne({ certId: str(req.params.certId, 40).toUpperCase() });
  if (!cert || String(cert.institution) !== String(inst(req))) throw notFound("Certificate not found");
  if (cert.revokedAt) throw conflict("Already revoked");
  cert.revokedAt = new Date();
  cert.revokeReason = reason;
  cert.revokedBy = req.user._id;
  await cert.save();
  audit(req, "event_certificate.revoke", "Certificate", cert._id, { reason });
  res.json({ success: true });
});

// Public verification lookup for completion certificates. Returns only
// non-sensitive fields; drafts are not verifiable.
export const verifyCompletion = async (certId) => {
  const c = await CompletionCertificate.findOne({ certId }).populate("institution", "name").lean();
  if (!c || ["pending_review", "rejected"].includes(c.status)) return null;
  let replacement = null;
  if (c.supersededBy) replacement = (await CompletionCertificate.findById(c.supersededBy).select("certId status").lean()) || null;
  return {
    kind: "nss_completion",
    certId: c.certId,
    studentName: c.studentName,
    title: TITLE[c.requirementType],
    policy: `${c.policyName} (v${c.policyVersion})`,
    institution: c.institution?.name || null,
    issuedAt: c.issuedAt,
    status: c.status,
    replacedBy: replacement?.status === "issued" ? replacement.certId : null,
    years: (c.snapshot?.evaluation?.years || []).map((y) => ({ label: y.label || yearLabel(y.year), hours: Math.round(y.minutes / 6) / 10 })),
  };
};

// Preview (?record=false) or record a recalculation under a different policy.
export const recalculate = handle(async (req, res) => {
  requireOfficer(req);
  const student = await loadOwn(Student, req.body?.student, req, "volunteer");
  const to = await loadOwn(ServicePolicy, req.body?.policy, req, "policy");
  const versions = [...new Set((await LedgerEntry.find({ student: student._id, policyVersion: T({ $ne: null }) }).distinct("policyVersion")).map(Number))].sort();
  const originals = await ServicePolicy.find({ institution: inst(req), family: to.family, version: T({ $in: versions }) }).lean();
  const before = [];
  for (const p of originals) before.push({ version: p.version, ...(await evaluate(student._id, p)).evaluation });
  const after = (await evaluate(student._id, to)).evaluation;
  if (!req.body?.record) return res.json({ success: true, preview: true, originalPolicyVersions: versions, before, after });
  const reason = reasonRequired(req.body?.reason, "record a recalculation");
  const rec = await Recalculation.create({ institution: inst(req), student: student._id, toPolicy: to._id, toPolicyVersion: to.version, originalPolicyVersions: versions, before, after, reason, by: req.user._id });
  audit(req, "policy.recalculate", "Recalculation", rec._id, { student: student._id, toVersion: to.version, reason });
  res.status(201).json({ success: true, recalculation: rec });
});
