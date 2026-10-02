import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

// Lazy credentials warning (fires once, after dotenv has loaded)
let _credentialsWarned = false;

// ── Hosted logo URL (Cloudinary — light variant, transparent bg) ──
const LOGO_URL =
  "https://res.cloudinary.com/dudbh7sex/image/upload/c_fit,h_88,w_88/v1/synapsis-brand/synapsis-email-logo-light.png";

/**
 * Build the Synapsis-branded HTML email — clean light theme.
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
                <div class="otp-digit" style="
                  width: 48px; height: 60px; line-height: 60px; text-align: center;
                  font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', 'Consolas', 'Courier New', monospace;
                  font-size: 28px; font-weight: 700; color: #059669;
                  background: #ecfdf5; border: 1.5px solid #a7f3d0;
                  border-radius: 12px;
                ">${digit}</div>
              </td>`
                )
                .join("")}
            </tr>
          </table>
          <p style="margin: 18px 0 0; font-size: 13px; color: #64748b; letter-spacing: 0.04em;">
            Valid for <strong style="color: #334155;">5 minutes</strong> &middot; Do not share this code
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
  <meta name="color-scheme" content="light"/>
  <meta name="supported-color-schemes" content="light"/>
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
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;">

  <!-- Preheader -->
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">
    ${otp ? `Your verification code: ${otp}` : text}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;
  </div>

  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%"
         style="background-color:#f1f5f9;">
    <tr>
      <td align="center" style="padding:48px 16px 56px;">

        <!-- ════════════ MAIN CARD ════════════ -->
        <table role="presentation" cellspacing="0" cellpadding="0" border="0"
               width="520" class="card"
               style="max-width:520px;width:100%;background:#ffffff;border:1px solid #e2e8f0;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.06);">

          <!-- ── Top emerald bar ── -->
          <tr>
            <td style="height:4px;background:linear-gradient(90deg,#047857,#10B981,#34d399,#10B981,#047857);"></td>
          </tr>

          <!-- ── Header with logo ── -->
          <tr>
            <td align="center" style="padding:40px 40px 24px;background:#ffffff;">
              <img src="${LOGO_URL}" alt="Synapsis" width="56" height="56"
                   style="display:block;margin:0 auto 18px;border:0;outline:none;" />
              <h1 style="margin:0;font-size:22px;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;color:#0f172a;">
                SYNAPSIS
              </h1>
              <p style="margin:5px 0 0;font-size:10.5px;letter-spacing:0.18em;text-transform:uppercase;color:#94a3b8;font-weight:600;">
                NSS Management System
              </p>
            </td>
          </tr>

          <!-- ── Divider ── -->
          <tr>
            <td style="padding:0 48px;">
              <div style="height:1px;background:linear-gradient(90deg,transparent 0%,#10B981 40%,#10B981 60%,transparent 100%);opacity:0.35;"></div>
            </td>
          </tr>

          <!-- ── Body ── -->
          <tr>
            <td align="center" class="body-cell" style="padding:36px 48px 16px;">
              <h2 style="margin:0 0 10px;font-size:24px;font-weight:600;color:#0f172a;line-height:1.3;letter-spacing:-0.02em;">
                ${subject}
              </h2>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.7;color:#64748b;">
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
              <div style="height:1px;background:#e2e8f0;"></div>
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
                      background:#ecfdf5;border:1px solid #a7f3d0;
                      text-align:center;line-height:32px;font-size:15px;
                    ">&#128274;</div>
                  </td>
                  <td valign="middle">
                    <p style="margin:0;font-size:12px;color:#94a3b8;line-height:1.6;">
                      Didn't request this? Safely ignore this email.<br/>
                      <span style="color:#64748b;">Never share your code with anyone.</span>
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- ── Footer ── -->
          <tr>
            <td style="background:#f8fafc;padding:28px 48px;text-align:center;border-top:1px solid #e2e8f0;">
              <p style="margin:0 0 8px;font-size:12px;color:#94a3b8;line-height:1.5;">
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

// Brevo's HTTPS API (port 443). Render's free tier blocks outbound SMTP
// ports, so Gmail SMTP works locally but silently fails in production; an
// HTTP email API sidesteps that. Needs BREVO_API_KEY plus a sender address
// verified in Brevo (EMAIL_FROM, falling back to EMAIL_USER).
async function sendViaBrevo(to, subject, text, html) {
  const from = process.env.EMAIL_FROM || process.env.EMAIL_USER;
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": process.env.BREVO_API_KEY, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      sender: { name: "Synapsis", email: from },
      to: [{ email: to }],
      subject: `${subject} — Synapsis`,
      textContent: text,
      htmlContent: html,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Brevo rejected the email (${res.status}): ${detail.slice(0, 300)}`);
  }
}

export const sendEmail = async (to, subject, text, buttonLabel = null, buttonLink = null) => {
  if (process.env.BREVO_API_KEY) {
    try {
      await sendViaBrevo(to, subject, text, buildEmailHtml(subject, text, buttonLabel, buttonLink));
      console.log(`✅ Email sent via Brevo to ${to}`);
      return;
    } catch (error) {
      console.error("❌ Brevo send failed, trying SMTP:", error.message);
    }
  }

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
      // Fail fast when the host blocks SMTP instead of hanging for minutes.
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    const htmlContent = buildEmailHtml(subject, text, buttonLabel, buttonLink);

    await transporter.sendMail({
      from: `"Synapsis" <${process.env.EMAIL_USER}>`,
      to,
      replyTo: process.env.EMAIL_USER,
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
