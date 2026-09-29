import nodemailer from "nodemailer";

// Warn once at startup if email credentials are missing (lazy check)
let _credentialsWarned = false;

// ── Hosted logo URL (Cloudinary) ──
const LOGO_URL =
  "https://res.cloudinary.com/dudbh7sex/image/upload/c_fit,h_88,w_88/v1/synapsis-brand/synapsis-email-logo.png";

/**
 * Build the Synapsis-branded HTML email.
 *
 * Smart template: detects OTP codes in `text` and renders them as prominent
 * individual digit boxes.  Falls back to a clean body + optional CTA button
 * for non-OTP emails (welcome, approval, password reset, etc.).
 */
function buildEmailHtml(subject, text, buttonLabel, buttonLink) {
  // Extract OTP if present (e.g. "Your OTP is 482901" or "Your OTP: 482901")
  const otpMatch = text.match(/\b(\d{4,8})\b/);
  const otp = otpMatch ? otpMatch[1] : null;

  // Clean the body text: strip the raw OTP digits, trailing "is"/":" etc.
  const bodyText = otp
    ? text
        .replace(otp, "")
        .replace(/\s*(is|:)\s*$/, "")
        .trim()
    : text;

  // ── OTP digit boxes ──
  const otpBlock = otp
    ? `
      <tr>
        <td align="center" style="padding: 4px 0 32px;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0">
            <tr>
              ${otp
                .split("")
                .map(
                  (digit) => `
              <td style="padding: 0 5px;">
                <div style="
                  width: 48px; height: 60px; line-height: 60px; text-align: center;
                  font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', 'Consolas', 'Courier New', monospace;
                  font-size: 28px; font-weight: 700; color: #10B981;
                  background: #111827; border: 1.5px solid #1f2937;
                  border-radius: 12px;
                  box-shadow: 0 2px 8px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.04);
                ">${digit}</div>
              </td>`
                )
                .join("")}
            </tr>
          </table>
          <p style="margin: 18px 0 0; font-size: 13px; color: #6b7280; letter-spacing: 0.04em;">
            Valid for <strong style="color: #9ca3af;">5 minutes</strong> &middot; Do not share this code
          </p>
        </td>
      </tr>`
    : "";

  // ── CTA button ──
  const ctaBlock =
    buttonLabel && buttonLink
      ? `
      <tr>
        <td align="center" style="padding: 8px 40px 32px;">
          <a href="${buttonLink}" target="_blank"
             style="
               display: inline-block; background: #10B981; color: #ffffff;
               text-decoration: none; padding: 14px 40px; border-radius: 10px;
               font-size: 15px; font-weight: 600; letter-spacing: 0.02em;
               box-shadow: 0 4px 14px rgba(16,185,129,0.35);
             ">
            ${buttonLabel} &#8594;
          </a>
        </td>
      </tr>`
      : "";

  const year = new Date().getFullYear();

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <meta name="color-scheme" content="dark light"/>
  <meta name="supported-color-schemes" content="dark light"/>
  <title>${subject}</title>
  <!--[if mso]>
  <style>table,td{font-family:Arial,Helvetica,sans-serif!important}</style>
  <![endif]-->
  <style>
    @media only screen and (max-width: 560px) {
      .card { width: 100% !important; border-radius: 0 !important; }
      .body-cell { padding-left: 24px !important; padding-right: 24px !important; }
      .otp-digit { width: 38px !important; height: 50px !important; line-height: 50px !important; font-size: 22px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#050810;font-family:-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;">

  <!-- Preheader -->
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">
    ${otp ? `Your verification code: ${otp}` : text}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;
  </div>

  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%"
         style="background-color:#050810;">
    <tr>
      <td align="center" style="padding:48px 16px 56px;">

        <!-- ════════════ MAIN CARD ════════════ -->
        <table role="presentation" cellspacing="0" cellpadding="0" border="0"
               width="520" class="card"
               style="max-width:520px;width:100%;background:#0f172a;border:1px solid #1e293b;border-radius:20px;overflow:hidden;">

          <!-- ── Top glow bar ── -->
          <tr>
            <td style="height:3px;background:linear-gradient(90deg,#047857,#10B981,#34d399,#10B981,#047857);"></td>
          </tr>

          <!-- ── Header with logo ── -->
          <tr>
            <td align="center" style="padding:40px 40px 24px;background:#0f172a;">
              <!-- Logo image (hosted on Cloudinary) -->
              <img src="${LOGO_URL}" alt="Synapsis" width="64" height="64"
                   style="display:block;margin:0 auto 20px;border:0;outline:none;" />
              <!-- Wordmark -->
              <h1 style="margin:0;font-size:22px;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;color:#f1f5f9;">
                SYNAPSIS
              </h1>
              <p style="margin:5px 0 0;font-size:10.5px;letter-spacing:0.18em;text-transform:uppercase;color:#64748b;font-weight:600;">
                NSS Management System
              </p>
            </td>
          </tr>

          <!-- ── Emerald divider ── -->
          <tr>
            <td style="padding:0 48px;">
              <div style="height:1px;background:linear-gradient(90deg,transparent 0%,#10B981 40%,#10B981 60%,transparent 100%);opacity:0.5;"></div>
            </td>
          </tr>

          <!-- ── Body ── -->
          <tr>
            <td align="center" class="body-cell" style="padding:36px 48px 16px;">
              <h2 style="margin:0 0 10px;font-size:24px;font-weight:600;color:#f8fafc;line-height:1.3;letter-spacing:-0.02em;">
                ${subject}
              </h2>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.7;color:#94a3b8;">
                ${bodyText || "Please use the code below to continue."}
              </p>
            </td>
          </tr>

          <!-- ── OTP digits ── -->
          ${otpBlock}

          <!-- ── CTA button ── -->
          ${ctaBlock}

          <!-- ── Thin divider ── -->
          <tr>
            <td style="padding:0 48px;">
              <div style="height:1px;background:#1e293b;"></div>
            </td>
          </tr>

          <!-- ── Security notice ── -->
          <tr>
            <td class="body-cell" style="padding:24px 48px 24px;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0"
                     style="margin:0 auto;">
                <tr>
                  <td valign="middle" style="padding-right:12px;">
                    <div style="
                      width:32px;height:32px;border-radius:50%;
                      background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.15);
                      text-align:center;line-height:32px;font-size:15px;
                    ">&#128274;</div>
                  </td>
                  <td valign="middle">
                    <p style="margin:0;font-size:12px;color:#64748b;line-height:1.6;">
                      Didn't request this? Safely ignore this email.<br/>
                      <span style="color:#475569;">Never share your code with anyone.</span>
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- ── Footer ── -->
          <tr>
            <td style="background:#0a0f1a;padding:28px 48px;text-align:center;border-top:1px solid #1e293b;">
              <p style="margin:0 0 8px;font-size:12px;color:#475569;line-height:1.5;">
                &copy; ${year} <strong style="color:#64748b;">Synapsis</strong>
                &nbsp;&middot;&nbsp; Built for the National Service Scheme
              </p>
              <p style="margin:0;font-size:11px;">
                <a href="https://synapsenssmanagement.vercel.app"
                   style="color:#10B981;text-decoration:none;font-weight:500;">
                  synapsenssmanagement.vercel.app
                </a>
              </p>
            </td>
          </tr>

        </table>
        <!-- ════════════ /MAIN CARD ════════════ -->

      </td>
    </tr>
  </table>
</body>
</html>`;
}

export const sendEmail = async (to, subject, text, buttonLabel = null, buttonLink = null) => {
  try {
    // Lazy warning (fires once, after dotenv has loaded)
    if (!_credentialsWarned && (!process.env.EMAIL_USER || !process.env.EMAIL_PASS)) {
      _credentialsWarned = true;
      console.warn(
        "⚠️  EMAIL_USER or EMAIL_PASS is not set — outbound emails will fail!\n" +
        "   Set these in your hosting dashboard (Render, etc.)."
      );
    }

    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      throw new Error(
        "EMAIL_USER or EMAIL_PASS environment variable is not set. " +
        "Cannot send email. Please configure these in your hosting dashboard."
      );
    }

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    const htmlContent = buildEmailHtml(subject, text, buttonLabel, buttonLink);

    await transporter.sendMail({
      from: `"Synapsis" <${process.env.EMAIL_USER}>`,
      to,
      subject: `${subject} — Synapsis`,
      text,
      html: htmlContent,
    });

    console.log(`✅ Email sent successfully to ${to}`);
  } catch (error) {
    console.error("❌ Error sending email:", error.message);
    throw error;
  }
};
