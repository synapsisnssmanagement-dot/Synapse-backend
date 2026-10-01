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
      return res.status(404).json({ success: false, valid: false, message: "No certificate found with this ID" });
    }

    res.json({
      success: true,
      valid: true,
      certificate: {
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
