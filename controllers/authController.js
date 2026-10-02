import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import Admin from "../models/Admin.js";
import Alumni from "../models/Alumni.js";
import Coordinator from "../models/Coordinator.js";
import Student from "../models/Student.js";
import Teacher from "../models/Teacher.js";

// `workspace` is the frontend portal; `tokenRole` is what authMiddleware and
// socketAuth expect in the JWT (students keep "student" even when volunteers,
// matching the existing student token).
const ACCOUNT_TYPES = [
  { workspace: "student", Model: Student, label: "Student", tokenRole: () => "student" },
  { workspace: "teacher", Model: Teacher, label: "Teacher", tokenRole: () => "teacher" },
  { workspace: "coordinator", Model: Coordinator, label: "Coordinator", tokenRole: () => "coordinator" },
  { workspace: "alumni", Model: Alumni, label: "Alumni", tokenRole: () => "alumni" },
  { workspace: "admin", Model: Admin, label: "Admin", tokenRole: (doc) => doc.role || "admin" },
];

const photoUrl = (doc) => {
  const image = doc?.profileImage;
  if (!image) return null;
  return typeof image === "string" ? image : image.url || null;
};

const publicProfile = (type, doc) => ({
  id: doc._id,
  name: doc.name || "",
  email: doc.email,
  role: type.workspace,
  photo: photoUrl(doc),
});

// One sign-in for every account type: the email decides the workspace, so
// nobody has to pick a role first. If the same email and password open more
// than one account (e.g. a student who later registered as alumni), the
// caller gets the list and retries with `workspace` set.
export const unifiedLogin = async (req, res) => {
  try {
    const typed = String(req.body?.email || "").trim();
    const password = String(req.body?.password || "");
    const requested = req.body?.workspace;

    if (!typed || !password) {
      return res.status(400).json({ success: false, message: "Enter your email and password." });
    }

    // Exact matches only (the query sanitizer rejects operators); trying the
    // lowercase form too covers people who type their address capitalised.
    const candidates = [...new Set([typed, typed.toLowerCase()])];
    const types = requested ? ACCOUNT_TYPES.filter((t) => t.workspace === requested) : ACCOUNT_TYPES;
    const found = await Promise.all(
      types.map(async (type) => {
        for (const email of candidates) {
          const doc = await type.Model.findOne({ email });
          if (doc) return { type, doc };
        }
        return { type, doc: null };
      })
    );

    const matches = [];
    for (const { type, doc } of found) {
      if (doc?.password && (await bcrypt.compare(password, doc.password))) matches.push({ type, doc });
    }

    if (!matches.length) {
      // Same message whether the email exists or not, so the form can't be used
      // to discover which addresses have accounts.
      return res.status(401).json({ success: false, message: "That email and password don't match any account." });
    }

    const usable = matches.filter(({ doc }) => doc.status === "active");
    if (!usable.length) {
      const status = matches[0].doc.status;
      return res.status(403).json({
        success: false,
        message:
          status === "rejected"
            ? "This account was not approved. Contact your institution's NSS coordinator."
            : "Your account is waiting for approval. You'll be able to sign in once it's approved.",
      });
    }

    if (usable.length > 1) {
      return res.status(409).json({
        success: false,
        message: "This email has more than one account. Choose which one to open.",
        workspaces: usable.map(({ type }) => ({ id: type.workspace, label: type.label })),
      });
    }

    const { type, doc } = usable[0];
    const token = jwt.sign({ id: doc._id, role: type.tokenRole(doc) }, process.env.JWT_SECRET, { expiresIn: "7d" });

    res.json({ success: true, token, user: publicProfile(type, doc) });
  } catch (error) {
    console.error("unifiedLogin failed:", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
};

// The signed-in account's display details, for the app shell (avatar, name).
export const getMe = async (req, res) => {
  const type =
    (req.admin && ACCOUNT_TYPES[4]) ||
    (req.alumni && ACCOUNT_TYPES[3]) ||
    (req.coordinator && ACCOUNT_TYPES[2]) ||
    (req.teacher && ACCOUNT_TYPES[1]) ||
    (req.student && ACCOUNT_TYPES[0]);
  if (!type) return res.status(401).json({ success: false, message: "Not signed in" });
  res.json({ success: true, user: publicProfile(type, req.user) });
};
