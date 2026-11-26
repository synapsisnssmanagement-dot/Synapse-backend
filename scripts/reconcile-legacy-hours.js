// Legacy hours reconciliation. DRY RUN unless --apply is given.
//
//   node scripts/reconcile-legacy-hours.js --uri <mongodb-uri> [--institution <id>]
//   node scripts/reconcile-legacy-hours.js --uri <uri> --apply --confirm <database-name> [--institution <id>]
//   node scripts/reconcile-legacy-hours.js --uri <uri> --rollback <batch-id> --confirm <database-name>
//
// The URI must be passed explicitly (it is never read from .env), and writes
// need --confirm with the exact database name. Writes only additive "legacy"
// ledger rows, keyed so a re-run never duplicates. Rollback deletes only the
// rows of one import batch. Take a backup (mongodump) before --apply.
import mongoose from "mongoose";
import Event from "../models/Event.js";
import LedgerEntry from "../models/LedgerEntry.js";
import { planLegacyImport } from "../utils/legacyImport.js";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]] : acc), [])
);
if (!args.uri || args.uri === true) {
  console.error("Pass --uri explicitly. This script does not read MONGODB_URL.");
  process.exit(1);
}
const writes = args.apply || args.rollback;

await mongoose.connect(args.uri);
const dbName = mongoose.connection.db.databaseName;
if (writes && args.confirm !== dbName) {
  console.error(`Refusing to write: pass --confirm ${dbName} to confirm the target database.`);
  await mongoose.disconnect();
  process.exit(1);
}

if (args.rollback) {
  const res = await LedgerEntry.deleteMany({ entryType: "legacy", importBatch: String(args.rollback) });
  console.log(`Rolled back batch ${args.rollback}: removed ${res.deletedCount} legacy rows.`);
  await mongoose.disconnect();
  process.exit(0);
}

const filter = { status: "Completed" };
if (args.institution) filter.institution = new mongoose.Types.ObjectId(String(args.institution));
const events = await Event.find(filter).select("institution title date endDate type hours calculatedHours attendance campDays").lean();
const batch = `legacy-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const rows = planLegacyImport(events, batch);
const existing = new Set((await LedgerEntry.find({ idempotencyKey: { $in: rows.map((r) => r.idempotencyKey) } }).select("idempotencyKey").lean()).map((r) => r.idempotencyKey));
const fresh = rows.filter((r) => !existing.has(r.idempotencyKey));

const byStudent = new Map();
for (const r of rows) {
  const k = String(r.student);
  const s = byStudent.get(k) || { regular: 0, camp: 0 };
  s[r.kind] += r.minutes;
  byStudent.set(k, s);
}
console.log(`Database: ${dbName}`);
console.log(`Completed events scanned: ${events.length}`);
console.log(`Legacy rows planned: ${rows.length} (already imported: ${existing.size}, new: ${fresh.length})`);
console.log(`Volunteers affected: ${byStudent.size}`);
for (const [sid, s] of [...byStudent].slice(0, 20)) console.log(`  ${sid}: regular ${s.regular} min, camp ${s.camp} min`);
if (byStudent.size > 20) console.log(`  … ${byStudent.size - 20} more`);

if (!args.apply) {
  console.log("\nDRY RUN — nothing written. Re-run with --apply --confirm <db> to import.");
} else {
  let inserted = 0;
  for (const r of fresh) {
    try {
      await LedgerEntry.create(r);
      inserted++;
    } catch (e) {
      if (e?.code !== 11000) throw e;
    }
  }
  console.log(`\nImported ${inserted} legacy rows as batch ${batch}. Roll back with --rollback ${batch} --confirm ${dbName}`);
}
await mongoose.disconnect();
