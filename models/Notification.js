import mongoose from "mongoose";
import { emitToUser } from "../sockets/io.js";

const notificationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      refPath: "userModel",  // dynamic reference
    },

    userModel: {
      type: String,
      required: true,
      enum: ["Student", "Teacher", "Coordinator", "Admin"],
    },

    institution: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Institution",
      required: true,
      index: true,
    },

    title: { type: String, required: true },

    message: { type: String, required: true },

    event: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Event",
      default: null,
    },

    read: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Every notification, wherever it's created, is pushed to its recipient's
// open tabs immediately instead of waiting for the next page load.
notificationSchema.post("save", function (doc) {
  emitToUser(doc.user, "notification:new", doc.toObject());
});
notificationSchema.post("insertMany", function (docs) {
  for (const doc of docs) emitToUser(doc.user, "notification:new", doc.toObject ? doc.toObject() : doc);
});

export default mongoose.model("Notification", notificationSchema);
