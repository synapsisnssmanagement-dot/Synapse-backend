import mongoose from "mongoose";

const auditLogSchema = new mongoose.Schema(
  {
    institution: { type: mongoose.Schema.Types.ObjectId, index: true },
    actor: { type: mongoose.Schema.Types.ObjectId },
    actorRole: String,
    action: { type: String, required: true },
    targetType: String,
    targetId: mongoose.Schema.Types.ObjectId,
    details: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export default mongoose.model("AuditLog", auditLogSchema);
