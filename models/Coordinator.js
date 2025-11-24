import mongoose from "mongoose";

const coordinatorSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    phoneNumber: { type: String, required: true },
    department: { type: String, required: true },
    password: { type: String, required: true },
    profileImage: { url: String, public_id: String },
    role: { type: String, enum: ["coordinator"], default: "coordinator" },
    status: {
      type: String,
      enum: ["pending", "active", "rejected"],
      default: "pending",
    },
    otp: { type: Number },
    otpExpiry: { type: Date },
    // managedEvents
    managedEvents: [{ type: mongoose.Schema.Types.ObjectId, ref: "Event" }],
    // eventSuggestions by coordinator where approved by admin
    eventSuggestions: [
      {
        title: String,
        description: String,
        location: String,
        date: Date,
        hours: Number,
        status: {
          type: String,
          enum: ["pending", "approved", "rejected"],
          default: "pending",
        },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    institution: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Institution",
      required: true,
    },
    verificationDocument: {
      url: { type: String, default: "" },
      public_id: { type: String, default: "" },
    },
    // grace mark recommendations they made
    graceRecommendations: [
      {
        student: { type: mongoose.Schema.Types.ObjectId, ref: "Student" },
        marks: Number,
        reason: String,
        status: {
          type: String,
          enum: ["pending", "approved", "rejected"],
          default: "pending",
        },
        createdAt: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

export default mongoose.model("Coordinator", coordinatorSchema);
