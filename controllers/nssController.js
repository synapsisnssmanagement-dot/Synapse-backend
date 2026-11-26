import PDFDocument from "pdfkit";
import mongoose from "mongoose";
import CommunityRequest from "../models/CommunityRequest.js";
import Coordinator from "../models/Coordinator.js";
import Donation from "../models/Donation.js";
import Event from "../models/Event.js";
import Institution from "../models/Institution.js";
import Notification from "../models/Notification.js";
import Student from "../models/Student.js";
import LedgerEntry from "../models/LedgerEntry.js";
import OutcomeRecord from "../models/OutcomeRecord.js";
import { emitToInstitution } from "../sockets/io.js";
import {
  NSS_TARGET_HOURS,
  NSS_YEARLY_HOURS,
  academicYearLabel,
  academicYearOf,
  computeEligibility,
  creditedHours,
  creditedStudentIds,
  rankVolunteers,
} from "../utils/nss.js";
import { denyCrossInstitution } from "../utils/ownership.js";
import { ledgerEligibility, yearMinutesByStudent } from "../utils/ledgerTotals.js";

const fail = (res, error, message = "Something went wrong. Please try again.") => {
  console.error("nssController:", error);
  if (!res.headersSent) res.status(500).json({ success: false, message });
};

const completedEvents = (institution) =>
  Event.find({ institution, status: "Completed" }).select("title date endDate type hours calculatedHours attendance campDays").lean();

const loadOwnEvent = async (req, res, select) => {
  if (!mongoose.isValidObjectId(req.params.eventId)) {
    res.status(400).json({ success: false, message: "Invalid event" });
    return null;
  }
  const event = await Event.findById(req.params.eventId).select(select);
  if (!event) {
    res.status(404).json({ success: false, message: "Event not found" });
    return null;
  }
  if (denyCrossInstitution(req, res, event)) return null;
  return event;
};

// ───────────── Certificate eligibility ─────────────

export const getEligibility = async (req, res) => {
  try {
    const institution = req.user.institution;
    const [volunteers, events] = await Promise.all([
      Student.find({ institution, role: "volunteer", status: "active" }).select("name email department profileImage").lean(),
      completedEvents(institution),
    ]);
    const map = computeEligibility(volunteers.map((v) => v._id), events);
    const ledger = await ledgerEligibility(institution, volunteers.map((v) => v._id));
    // Verified (ledger) figures are primary; attendance-derived figures are
    // returned alongside as `legacy` for the transition period.
    const rows = volunteers.map((v) => ({ ...v, ...ledger.map.get(String(v._id)), legacy: map.get(String(v._id)) }));
    res.json({
      success: true,
      rules: ledger.policy
        ? { targetHours: (ledger.policy.rules.regularMinutesPerYear * ledger.policy.rules.yearsRequired) / 60, yearlyHours: ledger.policy.rules.regularMinutesPerYear / 60, policy: { name: ledger.policy.name, version: ledger.policy.version, requirementType: ledger.policy.requirementType } }
        : { targetHours: NSS_TARGET_HOURS, yearlyHours: NSS_YEARLY_HOURS, policy: null },
      currentYear: academicYearLabel(academicYearOf(new Date())),
      volunteers: rows.sort((a, b) => b.total - a.total),
    });
  } catch (error) {
    fail(res, error);
  }
};

export const getMyEligibility = async (req, res) => {
  try {
    const events = await completedEvents(req.user.institution);
    const legacy = computeEligibility([req.user._id], events).get(String(req.user._id));
    const ledger = await ledgerEligibility(req.user.institution, [req.user._id]);
    const mine = { ...ledger.map.get(String(req.user._id)), legacy };
    res.json({
      success: true,
      rules: ledger.policy
        ? { targetHours: (ledger.policy.rules.regularMinutesPerYear * ledger.policy.rules.yearsRequired) / 60, yearlyHours: ledger.policy.rules.regularMinutesPerYear / 60, policy: { name: ledger.policy.name, version: ledger.policy.version } }
        : { targetHours: NSS_TARGET_HOURS, yearlyHours: NSS_YEARLY_HOURS, policy: null },
      currentYear: academicYearLabel(academicYearOf(new Date())),
      eligibility: mine,
    });
  } catch (error) {
    fail(res, error);
  }
};

// ───────────── Volunteer matching ─────────────

export const matchVolunteers = async (req, res) => {
  try {
    const event = await loadOwnEvent(req, res, "title description date type requiredSkills participants institution");
    if (!event) return;
    const institution = req.user.institution;
    const dayStart = new Date(event.date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const [volunteers, events, sameDay] = await Promise.all([
      Student.find({ institution, role: "volunteer", status: "active", _id: mongoose.trusted({ $nin: event.participants }) })
        .select("name email department talents")
        .lean(),
      completedEvents(institution),
      Event.find({ institution, date: mongoose.trusted({ $gte: dayStart, $lt: dayEnd }), status: mongoose.trusted({ $ne: "Cancelled" }) })
        .select("date participants")
        .lean(),
    ]);
    // Need for hours is judged on verified ledger service.
    const { map: eligibility } = await ledgerEligibility(institution, volunteers.map((v) => v._id));
    void events;
    res.json({ success: true, suggestions: rankVolunteers(event, volunteers, eligibility, sameDay) });
  } catch (error) {
    fail(res, error);
  }
};

// ───────────── Event extras: skills, venue pin, impact ─────────────

export const updateEventExtras = async (req, res) => {
  try {
    const event = await loadOwnEvent(req, res, "institution type endDate requiredSkills geo date");
    if (!event) return;
    const { type, endDate, requiredSkills, geo } = req.body;

    if (type !== undefined) {
      if (!["regular", "special_camp"].includes(type)) return res.status(400).json({ success: false, message: "Invalid event type" });
      event.type = type;
    }
    if (endDate !== undefined) {
      if (endDate === null || endDate === "") event.endDate = undefined;
      else {
        const d = new Date(endDate);
        if (Number.isNaN(d.getTime()) || d < event.date) return res.status(400).json({ success: false, message: "End date must be on or after the start date" });
        event.endDate = d;
      }
    }
    if (requiredSkills !== undefined) {
      if (!Array.isArray(requiredSkills)) return res.status(400).json({ success: false, message: "requiredSkills must be a list" });
      event.requiredSkills = requiredSkills.map((s) => String(s).trim()).filter(Boolean).slice(0, 12);
    }
    if (geo !== undefined) {
      if (geo === null) event.geo = undefined;
      else {
        const lat = Number(geo.lat);
        const lng = Number(geo.lng);
        const radius = Number(geo.radius ?? 300);
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
          return res.status(400).json({ success: false, message: "Invalid venue location" });
        }
        if (!Number.isFinite(radius) || radius < 50 || radius > 5000) {
          return res.status(400).json({ success: false, message: "Check-in radius must be between 50 and 5000 metres" });
        }
        event.geo = { lat, lng, radius };
      }
    }
    await event.save();
    res.json({ success: true, event });
  } catch (error) {
    fail(res, error);
  }
};

export const setImpact = async (req, res) => {
  try {
    const event = await loadOwnEvent(req, res, "institution status impact title");
    if (!event) return;
    const list = req.body?.impact;
    if (!Array.isArray(list) || list.length > 12) return res.status(400).json({ success: false, message: "Send up to 12 impact entries" });
    const clean = [];
    for (const item of list) {
      const metric = String(item?.metric || "").trim().slice(0, 60);
      const value = Number(item?.value);
      if (!metric || !Number.isFinite(value) || value < 0) {
        return res.status(400).json({ success: false, message: "Each entry needs a name and a number of zero or more" });
      }
      clean.push({ metric, value, unit: String(item?.unit || "").trim().slice(0, 20) });
    }
    event.impact = clean;
    await event.save();
    res.json({ success: true, impact: event.impact });
  } catch (error) {
    fail(res, error);
  }
};

// ───────────── Live event screen ─────────────

export const getLiveEvent = async (req, res) => {
  try {
    const event = await loadOwnEvent(req, res, "title date location status institution participants attendance geo type startTime");
    if (!event) return;
    await event.populate("participants", "name department profileImage");
    res.json({ success: true, event });
  } catch (error) {
    fail(res, error);
  }
};

// ───────────── Special camp ─────────────

const campDates = (event) => {
  const start = new Date(event.date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(event.endDate || event.date);
  end.setHours(0, 0, 0, 0);
  const out = [];
  for (let d = new Date(start); d <= end && out.length < 15; d.setDate(d.getDate() + 1)) out.push(new Date(d));
  return out;
};

export const getCamp = async (req, res) => {
  try {
    const event = await loadOwnEvent(req, res, "title date endDate type location status institution participants campDays campDiary");
    if (!event) return;
    if (event.type !== "special_camp") return res.status(400).json({ success: false, message: "This event isn't a special camp" });

    // Students only see camps they're on, and only their own roll-call record.
    if (req.student) {
      const me = String(req.user._id);
      if (!event.participants.some((p) => String(p) === me)) return res.status(403).json({ success: false, message: "You're not on this camp" });
      return res.json({
        success: true,
        camp: {
          _id: event._id,
          title: event.title,
          location: event.location,
          days: campDates(event).map((date) => {
            const rec = event.campDays.find((d) => d.date.toDateString() === date.toDateString());
            return { date, recorded: Boolean(rec), present: rec ? rec.present.some((p) => String(p) === me) : null };
          }),
          diary: event.campDiary,
        },
      });
    }

    await event.populate("participants", "name department profileImage");
    res.json({
      success: true,
      camp: {
        _id: event._id,
        title: event.title,
        location: event.location,
        status: event.status,
        participants: event.participants,
        days: campDates(event).map((date) => {
          const rec = event.campDays.find((d) => d.date.toDateString() === date.toDateString());
          return { date, recorded: Boolean(rec), present: rec ? rec.present.map(String) : [] };
        }),
        diary: event.campDiary,
      },
    });
  } catch (error) {
    fail(res, error);
  }
};

export const saveCampDay = async (req, res) => {
  try {
    const event = await loadOwnEvent(req, res, "type date endDate institution participants campDays");
    if (!event) return;
    if (event.type !== "special_camp") return res.status(400).json({ success: false, message: "This event isn't a special camp" });
    const date = new Date(req.body?.date);
    if (Number.isNaN(date.getTime()) || !campDates(event).some((d) => d.toDateString() === date.toDateString())) {
      return res.status(400).json({ success: false, message: "That day isn't part of the camp" });
    }
    const roster = new Set(event.participants.map(String));
    const present = [...new Set((req.body?.present || []).map(String))].filter((id) => roster.has(id));
    const existing = event.campDays.find((d) => d.date.toDateString() === date.toDateString());
    if (existing) existing.present = present;
    else event.campDays.push({ date, present });
    await event.save();
    res.json({ success: true, present });
  } catch (error) {
    fail(res, error);
  }
};

export const addCampDiary = async (req, res) => {
  try {
    const event = await loadOwnEvent(req, res, "type institution campDiary");
    if (!event) return;
    if (event.type !== "special_camp") return res.status(400).json({ success: false, message: "This event isn't a special camp" });
    const title = String(req.body?.title || "").trim().slice(0, 120);
    const body = String(req.body?.body || "").trim().slice(0, 4000);
    if (!title || body.length < 10) return res.status(400).json({ success: false, message: "Give the entry a title and at least a sentence" });
    event.campDiary.push({ title, body, authorName: req.user.name, date: new Date() });
    await event.save();
    res.json({ success: true, entry: event.campDiary[event.campDiary.length - 1] });
  } catch (error) {
    fail(res, error);
  }
};

// ───────────── Community requests ─────────────

const CATEGORIES = ["Health", "Environment", "Education", "Elderly care", "Disaster relief", "Sanitation", "Other"];

export const submitCommunityRequest = async (req, res) => {
  try {
    const b = req.body || {};
    const str = (v, max) => String(v ?? "").trim().slice(0, max);
    const data = {
      institution: b.institution,
      orgName: str(b.orgName, 120),
      contactName: str(b.contactName, 80),
      phone: str(b.phone, 20),
      email: str(b.email, 120),
      category: CATEGORIES.includes(b.category) ? b.category : "Other",
      description: str(b.description, 1500),
      location: str(b.location, 160),
      preferredDate: b.preferredDate ? new Date(b.preferredDate) : undefined,
    };
    if (!mongoose.isValidObjectId(data.institution) || !(await Institution.exists({ _id: data.institution }))) {
      return res.status(400).json({ success: false, message: "Choose the college you're asking for help from" });
    }
    if (!data.orgName || !data.contactName || data.phone.replace(/\D/g, "").length < 10 || !data.location || data.description.length < 30) {
      return res.status(400).json({ success: false, message: "Fill in every required field; the description needs at least 30 characters" });
    }
    if (data.preferredDate && Number.isNaN(data.preferredDate.getTime())) data.preferredDate = undefined;

    const request = await CommunityRequest.create(data);

    const coordinators = await Coordinator.find({ institution: data.institution, status: "active" }).select("_id").lean();
    if (coordinators.length) {
      await Notification.insertMany(
        coordinators.map((c) => ({
          user: c._id,
          userModel: "Coordinator",
          institution: data.institution,
          title: "New community request",
          message: `${data.orgName} is asking for help: ${data.category.toLowerCase()} in ${data.location}.`,
        }))
      );
    }
    emitToInstitution(data.institution, "request:new", { _id: request._id });
    res.status(201).json({ success: true, message: "Request sent" });
  } catch (error) {
    fail(res, error, "We couldn't send your request. Please try again.");
  }
};

export const listCommunityRequests = async (req, res) => {
  try {
    const requests = await CommunityRequest.find({ institution: req.user.institution })
      .sort({ status: 1, createdAt: -1 })
      .limit(200)
      .populate("event", "title date status")
      .lean();
    res.json({ success: true, requests });
  } catch (error) {
    fail(res, error);
  }
};

export const updateCommunityRequest = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid request" });
    const request = await CommunityRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ success: false, message: "Request not found" });
    if (denyCrossInstitution(req, res, request)) return;
    const { status } = req.body || {};
    if (!["new", "accepted", "declined"].includes(status)) return res.status(400).json({ success: false, message: "Invalid status" });
    request.status = status;
    await request.save();
    res.json({ success: true, request });
  } catch (error) {
    fail(res, error);
  }
};

// ───────────── Public impact wall ─────────────

export const getPublicImpact = async (req, res) => {
  try {
    const { institutionId } = req.params;
    if (!mongoose.isValidObjectId(institutionId)) return res.status(400).json({ success: false, message: "Invalid institution" });
    const institution = await Institution.findById(institutionId).select("name address").lean();
    if (!institution) return res.status(404).json({ success: false, message: "Institution not found" });

    // Public figures use approved data only: verified ledger service,
    // published verified outcomes, and legacy event impact an officer approved.
    const instId = new mongoose.Types.ObjectId(String(institutionId));
    const [events, ledger, perEvent, outcomes] = await Promise.all([
      Event.find({ institution: institutionId, status: "Completed" }).select("title date location type impact impactPublicApproved images").sort({ date: -1 }).lean(),
      LedgerEntry.aggregate([
        { $match: { institution: instId, entryType: { $ne: "legacy" }, programme: { $ne: "community_service" } } },
        { $group: { _id: null, minutes: { $sum: "$minutes" }, volunteers: { $addToSet: "$student" } } },
      ]),
      LedgerEntry.aggregate([
        { $match: { institution: instId, entryType: { $ne: "legacy" }, programme: { $ne: "community_service" }, event: { $ne: null } } },
        { $group: { _id: { e: "$event", s: "$student" }, m: { $sum: "$minutes" } } },
        { $match: { m: { $gt: 0 } } },
        { $group: { _id: "$_id.e", volunteers: { $sum: 1 } } },
      ]),
      OutcomeRecord.find({ institution: instId, "verification.status": "verified", "publication.approved": true, level: "reported" }).select("metric unit value event").lean(),
    ]);
    const totals = new Map();
    const add = (metric, unit, value) => {
      const key = `${metric.toLowerCase()}|${(unit || "").toLowerCase()}`;
      const t = totals.get(key) || { metric, unit, value: 0 };
      t.value += value;
      totals.set(key, t);
    };
    for (const o of outcomes) add(o.metric, o.unit, o.value);
    for (const e of events) if (e.impactPublicApproved) for (const i of e.impact || []) add(i.metric, i.unit, i.value);
    const volunteersByEvent = new Map(perEvent.map((x) => [String(x._id), x.volunteers]));
    const outcomesByEvent = new Map();
    for (const o of outcomes) if (o.event) outcomesByEvent.set(String(o.event), [...(outcomesByEvent.get(String(o.event)) || []), { metric: o.metric, value: o.value, unit: o.unit }]);

    res.json({
      success: true,
      institution,
      basis: "Verified service hours and published, verified outcomes only.",
      summary: { drives: events.length, volunteers: ledger[0]?.volunteers?.length || 0, hours: Math.round((ledger[0]?.minutes || 0) / 60), camps: events.filter((e) => e.type === "special_camp").length },
      impact: [...totals.values()].sort((a, b) => b.value - a.value),
      // Public page: titles, dates, places and approved outcomes only — never names.
      recent: events.slice(0, 12).map((e) => ({
        _id: e._id,
        title: e.title,
        date: e.date,
        location: e.location,
        type: e.type,
        impact: [...(e.impactPublicApproved ? e.impact || [] : []), ...(outcomesByEvent.get(String(e._id)) || [])],
        cover: e.images?.[0]?.url || null,
        volunteers: volunteersByEvent.get(String(e._id)) || 0,
      })),
    });
  } catch (error) {
    fail(res, error);
  }
};

// ───────────── Annual report PDF ─────────────

export const annualReport = async (req, res) => {
  try {
    const institutionId = req.user.institution;
    const startYear = Number(req.query.year) || academicYearOf(new Date());
    const from = new Date(startYear, 5, 1);
    const to = new Date(startYear + 1, 5, 1);

    const [institution, events, volunteers] = await Promise.all([
      Institution.findById(institutionId).select("name address").lean(),
      Event.find({ institution: institutionId, date: mongoose.trusted({ $gte: from, $lt: to }) })
        .select("title date endDate location type status hours calculatedHours attendance participants impact campDays")
        .sort({ date: 1 })
        .lean(),
      Student.find({ institution: institutionId, role: "volunteer" }).select("name department").lean(),
    ]);
    const completed = events.filter((e) => e.status === "Completed");
    const donations = await Donation.aggregate([
      { $match: { eventId: { $in: events.map((e) => e._id) } } },
      { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } },
    ]);

    // Hours come from the verified ledger for this academic year.
    const ledgerYear = await yearMinutesByStudent(institutionId, startYear);
    const yearHours = new Map();
    const active = new Set();
    let totalHours = 0;
    for (const [id, v] of ledgerYear) {
      const hrs = Math.round((v.regular + v.camp) / 6) / 10;
      if (hrs <= 0) continue;
      active.add(id);
      yearHours.set(id, hrs);
      totalHours += hrs;
    }
    void creditedStudentIds;
    const impact = new Map();
    for (const e of completed) {
      for (const i of e.impact || []) {
        const key = `${i.metric}|${i.unit || ""}`;
        impact.set(key, { metric: i.metric, unit: i.unit, value: (impact.get(key)?.value || 0) + i.value });
      }
    }
    const { map: eligibility } = await ledgerEligibility(institutionId, volunteers.map((v) => v._id));
    const eligibleCount = [...eligibility.values()].filter((s) => s.eligible).length;
    const nameOf = new Map(volunteers.map((v) => [String(v._id), v]));
    const top = [...yearHours.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);

    const label = academicYearLabel(startYear);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="NSS-Annual-Report-${label.replace("–", "-")}.pdf"`);

    const doc = new PDFDocument({ size: "A4", margin: 50, bufferPages: true });
    doc.pipe(res);
    const ink = "#0a0f1a";
    const muted = "#64748b";
    const brand = "#047857";
    const W = doc.page.width - 100;

    doc.fillColor(brand).font("Helvetica-Bold").fontSize(10).text("NATIONAL SERVICE SCHEME", { characterSpacing: 1.5 });
    doc.moveDown(0.4).fillColor(ink).fontSize(26).text(`Annual Report ${label}`);
    doc.moveDown(0.2).font("Helvetica").fontSize(13).fillColor(muted).text(institution?.name || "");
    if (institution?.address) doc.fontSize(10).text(institution.address);
    doc.moveDown(1.2);

    const stats = [
      ["Drives completed", completed.length],
      ["Volunteers who served", active.size],
      ["Volunteer hours", Math.round(totalHours)],
      ["Special camps", completed.filter((e) => e.type === "special_camp").length],
      ["Certificate-eligible volunteers", eligibleCount],
      ["Donations raised", `Rs. ${(donations[0]?.total || 0).toLocaleString("en-IN")}`],
    ];
    const colW = W / 3;
    const top0 = doc.y;
    stats.forEach(([k, v], i) => {
      const x = 50 + (i % 3) * colW;
      const y = top0 + Math.floor(i / 3) * 62;
      doc.rect(x, y, colW - 10, 52).fillAndStroke("#f8fafc", "#e2e8f0");
      doc.fillColor(ink).font("Helvetica-Bold").fontSize(18).text(String(v), x + 12, y + 9, { width: colW - 34 });
      doc.fillColor(muted).font("Helvetica").fontSize(9).text(k, x + 12, y + 33, { width: colW - 34 });
    });
    doc.x = 50;
    doc.y = top0 + 2 * 62 + 14;

    const heading = (text) => {
      if (doc.y > doc.page.height - 140) doc.addPage();
      doc.moveDown(0.6).fillColor(brand).font("Helvetica-Bold").fontSize(10).text(text.toUpperCase(), 50, doc.y, { characterSpacing: 1.2 });
      doc.moveDown(0.4).fillColor(ink).font("Helvetica").fontSize(10.5);
    };

    heading("Community impact");
    if (impact.size) {
      for (const i of [...impact.values()].sort((a, b) => b.value - a.value)) {
        doc.text(`• ${i.value.toLocaleString("en-IN")} ${i.unit || ""} — ${i.metric}`.replace(/\s+—/, " —"));
      }
    } else doc.fillColor(muted).text("No outcomes were recorded for this year's drives.");

    heading("Drives");
    if (events.length) {
      for (const e of events) {
        if (doc.y > doc.page.height - 90) doc.addPage();
        const present = creditedStudentIds(e).size;
        const line = `${new Date(e.date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}  ${e.title}${e.type === "special_camp" ? " (special camp)" : ""}`;
        doc.fillColor(ink).font("Helvetica-Bold").fontSize(10.5).text(line);
        doc
          .fillColor(muted)
          .font("Helvetica")
          .fontSize(9.5)
          .text(
            `${e.location} · ${e.status}${e.status === "Completed" ? ` · ${present} volunteers · ${Number(e.calculatedHours) || 0} h` : ""}` +
              ((e.impact || []).length ? ` · ${(e.impact || []).map((i) => `${i.value} ${i.unit || i.metric}`).join(", ")}` : "")
          );
        doc.moveDown(0.35);
      }
    } else doc.fillColor(muted).text("No drives were held in this year.");

    heading("Most dedicated volunteers");
    if (top.length) {
      top.forEach(([id, h], i) => {
        const v = nameOf.get(id);
        doc.fillColor(ink).text(`${i + 1}. ${v?.name || "Volunteer"}${v?.department ? `, ${v.department}` : ""} — ${Math.round(h * 10) / 10} hours`);
      });
    } else doc.fillColor(muted).text("No hours were credited this year.");

    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i += 1) {
      doc.switchToPage(i);
      doc.page.margins.bottom = 0;
      doc
        .fillColor(muted)
        .fontSize(8)
        .text(`Generated by Synapsis on ${new Date().toLocaleDateString("en-IN")} · Page ${i + 1} of ${range.count}`, 50, doc.page.height - 40, {
          width: W,
          align: "center",
          lineBreak: false,
        });
    }
    doc.end();
  } catch (error) {
    fail(res, error, "We couldn't build the report.");
  }
};
