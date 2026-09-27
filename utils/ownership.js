// Multi-tenant guards.
//
// Role middleware only proves *what* a caller is, not *whose* data they may
// touch. Without these checks a teacher at one institution can act on another
// institution's events and students simply by knowing an id.

export const belongsToInstitution = (user, doc) =>
  Boolean(user?.institution) &&
  Boolean(doc?.institution) &&
  String(doc.institution) === String(user.institution);

// Returns true when the request has been rejected, so callers can
// `if (denyCrossInstitution(req, res, doc)) return;`
export const denyCrossInstitution = (req, res, doc) => {
  if (belongsToInstitution(req.user, doc)) return false;
  res.status(403).json({
    success: false,
    message: "Not allowed: this record belongs to another institution",
  });
  return true;
};
