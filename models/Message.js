import mongoose from "mongoose";

const MessageSchema = new mongoose.Schema(
  {
    eventId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Event",
      required: true,
    },
    institutionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Institution",
      required: true,
    },
    sender: {
      id: { type: mongoose.Schema.Types.ObjectId, required: true },
      name: { type: String },
      role: { type: String },
    },
    content: { type: String },
    attachments: [{ url: String, filename: String }],
    readBy: [{ type: mongoose.Schema.Types.ObjectId }],
  },
  { timestamps: true }
);

export default mongoose.model("Message", MessageSchema);
