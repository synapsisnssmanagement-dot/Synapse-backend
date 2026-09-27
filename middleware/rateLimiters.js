import rateLimit, { ipKeyGenerator } from "express-rate-limit";

const message = (text) => ({ message: text });

// Institutions typically sit behind a single NAT address, so a purely
// IP-keyed limit would let one user's failures lock out everyone on campus.
// Bucketing per account within an IP keeps brute-force protection per-account
// while leaving other users unaffected.
const perAccountKey = (req, res) => {
  const ip = ipKeyGenerator(req, res);
  const account = req.body?.email || req.body?.id || "";
  return account ? `${ip}:${account}` : ip;
};

// Broad backstop for the whole API. High enough that a shared campus IP running
// several dashboards at once never reaches it.
export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 3000,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: message("Too many requests. Please try again later."),
});

// Login, signup and OTP verification. OTPs are short numeric codes, so without
// a limit here they can be guessed exhaustively in seconds. Successful requests
// are not counted, so ordinary logins never consume the budget.
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: perAccountKey,
  message: message("Too many attempts. Please try again in 15 minutes."),
});

// The AI routes cost money per call.
export const aiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: message("AI request limit reached. Please try again later."),
});
