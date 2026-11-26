import { creditedHours, creditedStudentIds } from "./nss.js";
import { academicYearFor, toMinutes } from "./serviceRules.js";

// Builds (without writing) one "legacy" ledger row per volunteer per completed
// event, from the same attendance-derived hours the old screens showed.
// Legacy rows are reported separately and never count as verified service
// unless a policy sets countLegacy.
export const planLegacyImport = (events, batch, startMonth = 6) => {
  const rows = [];
  for (const ev of events) {
    for (const sid of creditedStudentIds(ev)) {
      const minutes = toMinutes(creditedHours(ev, sid));
      if (minutes <= 0) continue;
      rows.push({
        institution: ev.institution,
        student: sid,
        event: ev._id,
        serviceDate: ev.date,
        academicYear: academicYearFor(ev.date, startMonth),
        kind: ev.type === "special_camp" ? "camp" : "regular",
        category: "legacy",
        entryType: "legacy",
        minutes,
        reason: "Imported from attendance-derived totals (not individually reviewed)",
        importBatch: batch,
        idempotencyKey: `legacy:${sid}:${ev._id}`,
      });
    }
  }
  return rows;
};
