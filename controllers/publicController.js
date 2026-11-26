import { verifyCompletion } from "./certController.js";
import Certificate from "../models/Certificate.js";

// Unauthenticated: anyone with a certificate ID can confirm it's genuine.
export const verifyCertificate = async (req, res) => {
  try {
    const certId = (req.params.certId || "").trim().toUpperCase();
    if (!certId) {
      return res.status(400).json({ success: false, valid: false, message: "Certificate ID is required" });
    }

    const certificate = await Certificate.findOne({ certId }).populate("institution", "name");
    if (!certificate) {
      const completion = await verifyCompletion(certId);
      if (completion) return res.json({ success: true, valid: completion.status === "issued", certificate: completion });
      return res.status(404).json({ success: false, valid: false, message: "No certificate found with this ID" });
    }

    res.json({
      success: true,
      valid: !certificate.revokedAt,
      certificate: {
        kind: "event_participation",
        status: certificate.revokedAt ? "revoked" : "issued",
        certId: certificate.certId,
        studentName: certificate.studentName,
        department: certificate.department,
        eventTitle: certificate.eventTitle,
        eventDate: certificate.eventDate,
        hours: certificate.hours,
        institution: certificate.institution?.name || null,
        issuedAt: certificate.issuedAt,
      },
    });
  } catch (error) {
    console.error("verifyCertificate failed:", error);
    res.status(500).json({ success: false, message: "Could not verify certificate" });
  }
};
