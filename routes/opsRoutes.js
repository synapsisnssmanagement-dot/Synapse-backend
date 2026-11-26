import express from "express";
import * as c from "../controllers/opsController.js";
import * as cert from "../controllers/certController.js";
import * as att from "../controllers/attendanceController.js";
import * as camp from "../controllers/campController.js";
import * as proj from "../controllers/projectController.js";
import * as out from "../controllers/outcomeController.js";
import * as fin from "../controllers/financeController.js";
import * as settings from "../controllers/settingsController.js";
import * as rep from "../controllers/reportController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();
router.use(protect);

router.get("/units", c.listUnits);
router.post("/units", c.createUnit);
router.patch("/units/:id", c.updateUnit);

router.get("/enrolments", c.listEnrolments);
router.post("/enrolments", c.createEnrolment);
router.patch("/enrolments/:id", c.updateEnrolment);

router.get("/policies/template", c.policyTemplate);
router.get("/policies", c.listPolicies);
router.post("/policies", c.createPolicy);
router.post("/policies/:id/activate", c.activatePolicy);
router.post("/policies/recalculate", cert.recalculate);

router.get("/diary/me", c.myDiary);
router.get("/diary/activities", c.myActivities);
router.post("/diary", c.createDiary);
router.patch("/diary/:id", c.updateDiary);
router.post("/diary/:id/submit", c.submitDiary);
router.get("/diary/review", c.reviewQueue);
router.post("/diary/bulk-approve", c.bulkApprove);
router.get("/diary/flags", c.diaryFlags);
router.post("/diary/:id/decide", c.decideDiary);

router.get("/passbook/me", c.myPassbook);
router.get("/passbook/:studentId", c.studentPassbook);
router.post("/ledger/:id/adjust", c.adjustLedger);

router.post("/grievances", c.createGrievance);
router.get("/grievances/me", c.myGrievances);
router.get("/grievances", c.listGrievances);
router.post("/grievances/:id/respond", c.respondGrievance);

router.get("/workspace", c.workspace);
router.post("/deadlines", c.createDeadline);
router.post("/deadlines/:id/done", c.completeDeadline);

router.get("/reports/types", rep.reportTypes);
router.get("/reports/templates", rep.listTemplates);
router.post("/reports/templates", rep.createTemplate);
router.post("/reports/templates/:id/activate", rep.activateTemplate);
router.get("/reports", rep.listReports);
router.post("/reports", rep.generateReport);
router.get("/reports/:id", rep.getReport);
router.post("/reports/:id/approve", rep.approveReport);
router.get("/reports/:id/csv", rep.reportCsv);
router.get("/reports/:id/pdf", rep.reportPdf);

router.get("/settings", settings.getSettings);
router.put("/settings", settings.updateSettings);
router.get("/officers", settings.listOfficers);

router.get("/finance/entries", fin.listEntries);
router.post("/finance/entries", fin.createEntry);
router.post("/finance/entries/:id/verify", fin.verifyEntry);
router.get("/finance/summary", fin.financeSummary);
router.get("/finance/utilisation", fin.utilisationDraft);
router.get("/finance/budgets", fin.listBudgets);
router.put("/finance/budgets", fin.setBudget);
router.get("/finance/reconciliations", fin.listReconciliations);
router.post("/finance/reconciliations", fin.createReconciliation);
router.post("/finance/reconciliations/:id/approve", fin.approveReconciliation);
router.get("/stock", fin.listStock);
router.post("/stock/items", fin.createStockItem);
router.post("/stock/movements", fin.stockMovement);
router.get("/meetings", fin.listMeetings);
router.post("/meetings", fin.saveMeeting);
router.patch("/meetings/:id", fin.saveMeeting);
router.post("/meetings/:id/approve", fin.approveMeeting);
router.get("/handovers", fin.listHandovers);
router.post("/handovers", fin.createHandover);
router.post("/handovers/:id/acknowledge", fin.acknowledgeHandover);

router.get("/projects", proj.listProjects);
router.post("/projects", proj.createProject);
router.get("/projects/:id", proj.getProject);
router.patch("/projects/:id", proj.updateProject);
router.post("/projects/:id/transition", proj.transitionProject);
router.post("/projects/:id/sessions", proj.addSession);
router.post("/projects/:id/follow-ups", proj.updateFollowUps);
router.get("/projects/:id/outcomes", out.listOutcomes);
router.post("/projects/:id/outcomes", out.reportOutcome);
router.post("/outcomes/:outcomeId/verify", out.verifyOutcome);
router.post("/outcomes/:outcomeId/partner", out.partnerConfirm);
router.post("/outcomes/:outcomeId/publish", out.publishOutcome);
router.post("/events/:eventId/impact-public", out.approveLegacyImpact);

router.get("/camps", camp.listCamps);
router.post("/camps", camp.createCamp);
router.get("/camps/:id", camp.getCamp);
router.patch("/camps/:id", camp.updateCamp);
router.post("/camps/:id/transition", camp.transitionCamp);
router.post("/camps/:id/apply", camp.applyToCamp);
router.post("/camps/:id/applications", camp.decideApplication);
router.post("/camps/:id/documents", camp.recordDocument);
router.get("/camps/:id/emergency-contacts", camp.getEmergencyContacts);
router.put("/camps/:id/emergency-contacts", camp.setEmergencyContact);
router.get("/camps/:id/incidents", camp.listIncidents);
router.post("/camps/:id/incidents", camp.reportIncident);
router.patch("/incidents/:incidentId", camp.updateIncident);
router.get("/camps/:id/completion", camp.completionReview);
router.post("/camps/:id/completion", camp.decideCompletion);
router.post("/camps/:id/closing-report", camp.closingReport);

router.get("/attendance/roster", att.roster);
router.get("/attendance/me", att.myAttendance);
router.get("/attendance/live", att.myLiveActivities);
router.get("/attendance/activities", att.supervisedActivities);
router.get("/attendance/queue", att.attendanceQueue);
router.post("/attendance/sync", att.syncAttendance);
router.post("/attendance/self/:action", att.selfCheck);
router.post("/attendance/:id/verify", att.verifyAttendance);
router.post("/attendance/:id/correct", att.correctAttendance);
router.post("/attendance/:id/resolve", att.resolveConflict);

router.get("/certificates", cert.listCertificates);
router.get("/certificates/preview", cert.previewCertificate);
router.post("/certificates", cert.prepareCertificate);
router.post("/certificates/:id/review", cert.reviewCertificate);
router.post("/certificates/:id/revoke", cert.revokeCertificate);
router.post("/certificates/:id/reissue", cert.reissueCertificate);
router.get("/certificates/:id/pdf", cert.certificatePdf);
router.post("/event-certificates/:certId/revoke", cert.revokeEventCertificate);

export default router;
