import mongoose from "mongoose";

// Stock register: consumables and equipment. `quantity` is maintained only
// by StockMovement writes (atomic, never below zero).
const stockItemSchema = new mongoose.Schema(
  {
    institution: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    kind: { type: String, enum: ["consumable", "equipment"], required: true },
    unit: { type: String, trim: true, maxlength: 30, default: "nos" },
    quantity: { type: Number, default: 0, min: 0 },
    issuedOut: { type: Number, default: 0, min: 0 }, // equipment currently issued
    location: { type: String, maxlength: 120, default: "" },
  },
  { timestamps: true }
);
stockItemSchema.index({ institution: 1, name: 1 }, { unique: true });

export const StockItem = mongoose.model("StockItem", stockItemSchema);

const stockMovementSchema = new mongoose.Schema(
  {
    institution: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    item: { type: mongoose.Schema.Types.ObjectId, ref: "StockItem", required: true, index: true },
    type: { type: String, enum: ["receive", "consume", "issue", "return", "write_off"], required: true },
    quantity: { type: Number, required: true, min: 0.001 },
    holderName: { type: String, maxlength: 120, default: "" }, // equipment issued to
    holder: { type: mongoose.Schema.Types.ObjectId },
    dueBack: Date,
    issue: { type: mongoose.Schema.Types.ObjectId, ref: "StockMovement" }, // return → its issue
    camp: { type: mongoose.Schema.Types.ObjectId, ref: "CampPlan" },
    project: { type: mongoose.Schema.Types.ObjectId, ref: "Project" },
    reference: { type: String, maxlength: 200, default: "" },
    reason: { type: String, maxlength: 500, default: "" },
    by: { type: mongoose.Schema.Types.ObjectId, required: true },
    opId: { type: String, required: true, unique: true },
  },
  { timestamps: true }
);

export const StockMovement = mongoose.model("StockMovement", stockMovementSchema);
