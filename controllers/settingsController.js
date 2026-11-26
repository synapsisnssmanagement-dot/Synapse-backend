// Institution settings: approval chains (projects, camps), school type and
// privacy defaults. Changes are audited and kept in history.
import Coordinator from "../models/Coordinator.js";
import InstitutionSettings from "../models/InstitutionSettings.js";
import Teacher from "../models/Teacher.js";
import { DEFAULT_CHAIN } from "../utils/approvals.js";
import { audit, bad, handle, inst, oid, reasonRequired, requireActive, requireOfficer, str, T } from "../utils/opsHelpers.js";

export const getSettings = handle(async (req, res) => {
  requireActive(req);
  if (!req.coordinator && !req.teacher) throw bad("Not available");
  const s = await InstitutionSettings.findOne({ institution: inst(req) }).lean();
  res.json({
    success: true,
    settings: {
      kind: s?.kind || "college",
      approvalChains: { project: s?.approvalChains?.project?.length ? s.approvalChains.project : DEFAULT_CHAIN, camp: s?.approvalChains?.camp?.length ? s.approvalChains.camp : DEFAULT_CHAIN },
      privacy: s?.privacy || { publicProfilesDefault: "visible", minorsPublicProfile: "hidden" },
      history: s?.history || [],
    },
  });
});

const cleanChain = async (req, chain) => {
  if (!Array.isArray(chain) || !chain.length || chain.length > 5) throw bad("An approval chain has 1 to 5 steps");
  const steps = chain.map((st) => ({ name: str(st.name, 120), approvers: (st.approvers || []).map((a) => oid(a, "approver")) }));
  if (steps.some((s) => !s.name)) throw bad("Name every approval step");
  const ids = [...new Set(steps.flatMap((s) => s.approvers.map(String)))];
  if (ids.length) {
    const [c, t] = await Promise.all([
      Coordinator.countDocuments({ _id: T({ $in: ids }), institution: inst(req) }),
      Teacher.countDocuments({ _id: T({ $in: ids }), institution: inst(req) }),
    ]);
    if (c + t !== ids.length) throw bad("Approvers must belong to your institution");
  }
  return steps;
};

export const updateSettings = handle(async (req, res) => {
  requireOfficer(req);
  const b = req.body || {};
  const reason = reasonRequired(b.reason, "change institution settings");
  const set = {};
  if (b.kind !== undefined) {
    if (!["college", "higher_secondary_school", "school_with_lower_classes"].includes(b.kind)) throw bad("Invalid institution type");
    set.kind = b.kind;
  }
  if (b.approvalChains?.project) set["approvalChains.project"] = await cleanChain(req, b.approvalChains.project);
  if (b.approvalChains?.camp) set["approvalChains.camp"] = await cleanChain(req, b.approvalChains.camp);
  if (b.privacy) {
    set.privacy = {
      publicProfilesDefault: b.privacy.publicProfilesDefault === "hidden" ? "hidden" : "visible",
      minorsPublicProfile: b.privacy.minorsPublicProfile === "first_name_only" ? "first_name_only" : "hidden",
    };
  }
  if (!Object.keys(set).length) throw bad("Nothing to change");
  set.updatedBy = req.user._id;
  const s = await InstitutionSettings.findOneAndUpdate(
    { institution: inst(req) },
    { $set: set, $push: { history: { by: req.user._id, change: `${Object.keys(set).filter((k) => k !== "updatedBy").join(", ")}: ${reason}` } } },
    { new: true, upsert: true }
  );
  audit(req, "settings.update", "InstitutionSettings", s._id, { keys: Object.keys(set), reason });
  res.json({ success: true, settings: s });
});

export const listOfficers = handle(async (req, res) => {
  requireOfficer(req);
  const [officers, teachers] = await Promise.all([
    Coordinator.find({ institution: inst(req), status: "active" }).select("name").lean(),
    Teacher.find({ institution: inst(req), status: "active" }).select("name").lean(),
  ]);
  res.json({ success: true, officers, teachers });
});
