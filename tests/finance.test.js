import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { client, startEnv } from "./harness.js";
import { TAG, activePolicy, baseFixtures } from "./fixtures.js";
import Donation from "../models/Donation.js";
import Event from "../models/Event.js";
import FinanceEntry from "../models/FinanceEntry.js";
import mongoose from "mongoose";

let env, call, F;
const op = () => `op-${Math.random().toString(36).slice(2, 12)}`;
const post = (path, body, t = F.t.po) => call("POST", `/api/ops${path}`, t, body);

before(async () => {
  env = await startEnv();
  call = client(env.base);
  F = await baseFixtures();
  await activePolicy(F.instA, F.po);
  const ev = await Event.create({ title: `${TAG} Drive`, description: "x", date: new Date("2025-08-01"), location: "x", institution: F.instA._id });
  await Donation.create({ eventId: ev._id, alumniId: new mongoose.Types.ObjectId(), amount: 1500.5, paymentId: "pi_SYNTHETIC_1", createdAt: new Date("2025-08-02") });
});
after(() => env?.stop());

test("grants, advances, expenses against advances, reversals; money kept distinct", async () => {
  const g = { opId: op(), kind: "grant", amountPaise: 5000000, date: "2025-07-01", description: "SYNTHETIC unit grant", source: "SYNTHETIC body", reference: "SANCTION-1" };
  let r = await post("/finance/entries", g);
  assert.equal(r.status, 201);
  assert.equal((await post("/finance/entries", g)).data.duplicate, true, "retry does not duplicate");
  assert.equal(await FinanceEntry.countDocuments({ kind: "grant" }), 1);
  assert.equal((await post("/finance/entries", { ...g, opId: op(), amountPaise: 10.5 })).status, 400, "paise must be integer");
  assert.equal((await post("/finance/entries", { ...g, opId: op() }, F.t.teacher)).status, 403);

  const adv = (await post("/finance/entries", { opId: op(), kind: "advance", amountPaise: 1000000, date: "2025-07-05", description: "Camp advance", holder: F.teacher._id })).data.entry;
  assert.equal((await post("/finance/entries", { opId: op(), kind: "expense", amountPaise: 700000, date: "2025-07-06", head: "food", description: "Groceries" , advance: adv._id })).status, 400, "expense needs voucher/receipt");
  assert.equal((await post("/finance/entries", { opId: op(), kind: "expense", amountPaise: 700000, date: "2025-07-06", head: "food", description: "Groceries", reference: "V-1", advance: adv._id })).status, 201);
  assert.equal((await post("/finance/entries", { opId: op(), kind: "expense", amountPaise: 400000, date: "2025-07-06", head: "food", description: "Too much", reference: "V-2", advance: adv._id })).status, 400, "exceeds outstanding advance");
  assert.equal((await post("/finance/entries", { opId: op(), kind: "advance_return", amountPaise: 300000, date: "2025-07-08", description: "Unspent", advance: adv._id })).status, 201);
  const wrong = (await post("/finance/entries", { opId: op(), kind: "expense", amountPaise: 200000, date: "2025-07-09", head: "transport", description: "Bus", reference: "V-3" })).data.entry;
  assert.equal((await post("/finance/entries", { opId: op(), kind: "reversal", reverses: wrong._id })).status, 400, "reason required");
  assert.equal((await post("/finance/entries", { opId: op(), kind: "reversal", reverses: wrong._id, reason: "Duplicate voucher" })).status, 201);
  assert.equal((await post("/finance/entries", { opId: op(), kind: "reversal", reverses: wrong._id, reason: "again" })).status, 409, "only once");
  assert.equal((await call("GET", "/api/ops/finance/entries", F.t.poB)).data.entries.length, 0, "institution isolation");

  const s = (await call("GET", "/api/ops/finance/summary?academicYear=2025", F.t.po)).data;
  assert.equal(s.grantsPaise, 5000000);
  assert.equal(s.expensesPaise, 700000, "reversed expense excluded");
  assert.deepEqual(s.expensesByHead, { food: 700000 });
  assert.equal(s.advancesOutstanding.length, 0);
  assert.equal(s.donations.amountPaise, 150050, "donations read separately from the payment records");
  assert.equal(s.registerBalancePaise, 5000000 - 700000 - 1000000 + 300000);

  // Verification by a second officer.
  assert.equal((await post(`/finance/entries/${wrong._id}/verify`, {})).status, 403);
  assert.equal((await post(`/finance/entries/${wrong._id}/verify`, {}, F.t.po2)).status, 200);

  const u = (await call("GET", "/api/ops/finance/utilisation?academicYear=2025", F.t.po)).data;
  assert.match(u.status, /DRAFT/);
  assert.equal(u.unspentPaise, 4300000);
});

test("reconciliation flags differences and needs a second officer", async () => {
  let r = await post("/finance/reconciliations", { from: "2025-06-01", to: "2026-06-01", openingBalancePaise: 0, statementBalancePaise: 3500000 });
  assert.equal(r.data.reconciliation.differencePaise, -100000);
  const id = r.data.reconciliation._id;
  assert.equal((await post(`/finance/reconciliations/${id}/approve`, {}, F.t.po)).status, 403);
  assert.equal((await post(`/finance/reconciliations/${id}/approve`, {}, F.t.po2)).status, 400, "difference needs explanation");
  assert.equal((await post(`/finance/reconciliations/${id}/approve`, { explanation: "Bank charges not yet recorded" }, F.t.po2)).data.reconciliation.status, "approved");
});

test("stock: no negative stock, equipment issue/return, idempotent movements", async () => {
  const soap = (await post("/stock/items", { name: "Soap", kind: "consumable", unit: "bars" })).data.item;
  const spade = (await post("/stock/items", { name: "Spade", kind: "equipment" })).data.item;
  const m = { opId: op(), item: soap._id, type: "receive", quantity: 10 };
  await post("/stock/movements", m);
  assert.equal((await post("/stock/movements", m)).data.duplicate, true);
  assert.equal((await post("/stock/movements", { opId: op(), item: soap._id, type: "consume", quantity: 11 })).status, 400);
  assert.equal((await post("/stock/movements", { opId: op(), item: soap._id, type: "consume", quantity: 4 })).data.item.quantity, 6);
  await post("/stock/movements", { opId: op(), item: spade._id, type: "receive", quantity: 3 });
  const iss = (await post("/stock/movements", { opId: op(), item: spade._id, type: "issue", quantity: 2, holderName: "SYNTHETIC Team A" })).data.movement;
  assert.equal((await post("/stock/movements", { opId: op(), item: spade._id, type: "issue", quantity: 2, holderName: "B" })).status, 400, "only 1 left on hand");
  assert.equal((await post("/stock/movements", { opId: op(), item: spade._id, type: "write_off", quantity: 2, reason: "broken" })).status, 400, "cannot write off issued items");
  assert.equal((await post("/stock/movements", { opId: op(), item: spade._id, type: "return", quantity: 3, issue: iss._id })).status, 400);
  assert.equal((await post("/stock/movements", { opId: op(), item: spade._id, type: "return", quantity: 1, issue: iss._id })).status, 201);
  const st = (await call("GET", "/api/ops/stock", F.t.po)).data;
  assert.equal(st.outstandingIssues[0].outstanding, 1);
  // Concurrency: two simultaneous consumes of the last 6 bars → only one of 4+4 succeeds.
  const rs = await Promise.all([1, 2].map(() => post("/stock/movements", { opId: op(), item: soap._id, type: "consume", quantity: 4 })));
  assert.deepEqual(rs.map((x) => x.status).sort(), [201, 400]);
});

test("meetings lock after approval; handover snapshot and acknowledgement", async () => {
  const m = (await post("/meetings", { date: "2025-09-01", attendees: [{ name: "SYNTHETIC Principal", role: "Chair" }], agenda: "Annual plan", minutes: "" })).data.meeting;
  assert.equal((await post(`/meetings/${m._id}/approve`, {})).status, 400);
  await call("PATCH", `/api/ops/meetings/${m._id}`, F.t.po, { minutes: "Plan approved. Camp in December.", actionItems: [{ task: "Book bus", owner: "PO" }] });
  assert.equal((await post(`/meetings/${m._id}/approve`, {})).status, 200);
  assert.equal((await call("PATCH", `/api/ops/meetings/${m._id}`, F.t.po, { minutes: "rewritten" })).status, 409);

  const h = (await post("/handovers", { toOfficer: F.po2._id, effectiveDate: "2026-06-01", checklist: ["Keys", "Cash book"] })).data.handover;
  assert.equal(h.snapshot.equipmentOut.length, 1);
  assert.equal(h.snapshot.openMeetingActions.length, 1);
  assert.equal((await post(`/handovers/${h._id}/acknowledge`, {}, F.t.po)).status, 403);
  assert.equal((await post(`/handovers/${h._id}/acknowledge`, { note: "Received" }, F.t.po2)).data.handover.status, "acknowledged");
  assert.equal((await post("/handovers", { toOfficer: F.poB._id, effectiveDate: "2026-06-01" })).status, 404, "cannot hand over to another institution");
});
