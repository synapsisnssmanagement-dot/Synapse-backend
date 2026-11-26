// Shared helpers for the NSS operations controllers: errors, validation,
// authorisation guards and audit logging.
import mongoose from "mongoose";
import AuditLog from "../models/AuditLog.js";

// server.js enables sanitizeFilter; server-built operators are marked trusted.
export const T = (o) => mongoose.trusted(o);

// ───────── helpers ─────────
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export const bad = (m) => new HttpError(400, m);
export const forbid = (m = "Not allowed") => new HttpError(403, m);
export const notFound = (m = "Not found") => new HttpError(404, m);
export const conflict = (m) => new HttpError(409, m);

export const handle = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (e) {
    if (e instanceof HttpError) return res.status(e.status).json({ success: false, message: e.message });
    if (e?.name === "ValidationError" || e?.name === "CastError") return res.status(400).json({ success: false, message: "Invalid input" });
    if (e?.code === 11000) return res.status(409).json({ success: false, message: "This record already exists" });
    console.error("opsController:", e?.message);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
};

export const oid = (v, label = "id") => {
  if (!mongoose.isValidObjectId(v)) throw bad(`Invalid ${label}`);
  return new mongoose.Types.ObjectId(String(v));
};
export const pick = (obj = {}, keys) => Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));
export const str = (v, max = 4000) => (v == null ? "" : String(v).trim().slice(0, max));
export const int = (v, label, { min = 0, max = 100000 } = {}) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`${label} must be a whole number between ${min} and ${max}`);
  return n;
};
export const date = (v, label) => {
  const d = new Date(v);
  if (v == null || Number.isNaN(d.getTime())) throw bad(`Invalid ${label}`);
  return d;
};
export const reasonRequired = (r, what) => {
  const s = str(r, 1000);
  if (s.length < 3) throw bad(`A reason is required to ${what}`);
  return s;
};
export const evidenceList = (list) =>
  (Array.isArray(list) ? list : []).slice(0, 10).map((e) => {
    const url = str(e?.url, 1000);
    if (url && !/^https:\/\//i.test(url)) throw bad("Evidence links must be https URLs");
    return { label: str(e?.label, 200), url };
  });

export const inst = (req) => req.user.institution;
export const roleOf = (req) => req.user.role;
export const isActive = (req) => req.user.status === undefined || req.user.status === "active";
export const requireActive = (req) => {
  if (!isActive(req)) throw forbid("Your account is not active yet");
};
export const requireOfficer = (req) => {
  if (!req.coordinator) throw forbid("Programme Officers only");
  requireActive(req);
};
export const requireVolunteer = (req) => {
  if (!req.student || req.student.role !== "volunteer") throw forbid("Volunteers only");
  requireActive(req);
};
export const sameInst = (req, doc) => doc && String(doc.institution) === String(inst(req));
export const loadOwn = async (Model, id, req, label) => {
  const doc = await Model.findById(oid(id, label));
  if (!doc || !sameInst(req, doc)) throw notFound(`${label[0].toUpperCase()}${label.slice(1)} not found`); // 404 hides cross-institution records
  return doc;
};
export const audit = (req, action, targetType, targetId, details) =>
  AuditLog.create({ institution: inst(req), actor: req.user._id, actorRole: roleOf(req), action, targetType, targetId, details }).catch((e) =>
    console.error("audit failed:", e.message)
  );

