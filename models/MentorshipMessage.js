import mongoose from "mongoose";

const messageSchema = new mongoose.Schema(
  {
    mentorship: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Mentorship",
      required: true,
    },

    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },

    senderRole: {
      type: String,
      enum: ["student", "alumni"],
      required: true,
    },

    message: {
      type: String,
      required: true,
    },
  },
  { timestamps: true }
);

export default mongoose.model("MentorshipMessage", messageSchema);
