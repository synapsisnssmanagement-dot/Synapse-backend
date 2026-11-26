// Institution-configurable approval chains for projects and camps. Default is
// a single Programme Officer approval; schools can add steps (e.g. Principal)
// with named approvers. Steps are signed in order, by distinct people.
import InstitutionSettings from "../models/InstitutionSettings.js";

export const DEFAULT_CHAIN = [{ name: "Programme Officer", approvers: [] }];

export const chainFor = async (institution, kind) => {
  const s = await InstitutionSettings.findOne({ institution }).lean();
  const chain = s?.approvalChains?.[kind];
  return chain?.length ? chain : DEFAULT_CHAIN;
};

const canSign = (req, step) => {
  if (req.user.status !== undefined && req.user.status !== "active") return false;
  if (step.approvers?.length) return step.approvers.some((a) => String(a) === String(req.user._id));
  return Boolean(req.coordinator);
};

// Returns { step, index, done } for the next signature, or throws a message.
export const nextApproval = (chain, approvals = []) => {
  const signed = approvals.filter((a) => a.decision === "approved");
  if (signed.length >= chain.length) return { done: true };
  return { index: signed.length, step: chain[signed.length], done: false };
};

export const checkCanSign = (req, chain, approvals) => {
  const next = nextApproval(chain, approvals);
  if (next.done) return { error: "Already fully approved" };
  if (!canSign(req, next.step)) return { error: `Waiting for: ${next.step.name}` };
  if (approvals.some((a) => a.decision === "approved" && String(a.by) === String(req.user._id)) && chain.length > 1)
    return { error: "Each approval step must be signed by a different person" };
  return { next };
};
