// 

import nodemailer from "nodemailer";

export const sendEmail = async (to, subject, text, buttonLabel = null, buttonLink = null) => {
  try {
    // Create transporter
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    // HTML template (inline)
    const htmlContent = `
      <div style="margin:0; padding:0; background-color:#f6f9fc; font-family: 'Segoe UI', Arial, sans-serif;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
          <tr>
            <td align="center" style="padding: 40px 0;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="background: #ffffff; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.08); overflow: hidden;">
                
                <!-- Header -->
                <tr>
                  <td style="background: #00ff00; color: #ffffff; text-align: center; padding: 25px;">
                    <h1 style="margin: 0; font-size: 26px;">Synapsis-Nss managemnt Portal</h1>
                  </td>
                </tr>

                <!-- Body -->
                <tr>
                  <td style="padding: 30px 40px; color: #333333;">
                    <h2 style="margin-top: 0; font-size: 22px; color: #111;">${subject}</h2>
                    <p style="font-size: 16px; line-height: 1.6;">${text}</p>

                    ${
                      buttonLabel && buttonLink
                        ? `
                        <div style="text-align: center; margin-top: 30px;">
                          <a href="${buttonLink}" 
                             style="display: inline-block; background: linear-gradient(90deg, #007bff, #00c6ff);
                                    color: #fff; text-decoration: none; padding: 12px 24px;
                                    border-radius: 6px; font-size: 16px; font-weight: 500;">
                            ${buttonLabel}
                          </a>
                        </div>
                        `
                        : ""
                    }

                    <p style="margin-top: 40px; font-size: 13px; color: #777;">
                      If you did not request this email, you can safely ignore it.
                    </p>
                  </td>
                </tr>

                <!-- Footer -->
                <tr>
                  <td style="background: #f0f0f0; text-align: center; padding: 15px;">
                    <p style="margin: 0; font-size: 13px; color: #999;">
                      &copy; ${new Date().getFullYear()} MyApp. All rights reserved.<br/>
                      <a href="https://myapp.com" style="color:#007bff; text-decoration:none;">Visit our website</a>
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </div>
    `;

    // Send email
    await transporter.sendMail({
      from: `"Synapsis-Nss Management Portal" <${process.env.EMAIL_USER}>`,
      to,
      subject,
      text, // plain text fallback
      html: htmlContent,
    });

    console.log(`✅ Email sent successfully to ${to}`);
  } catch (error) {
    console.error("❌ Error sending email:", error.message);
  }
};
