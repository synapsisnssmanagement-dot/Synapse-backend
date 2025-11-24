import mongoose from "mongoose";

const eventSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    description: { type: String, required: true },
    date: { type: Date, required: true },
    location: { type: String, required: true },
    hours: { type: Number, default: 0, min: [0, "Hours cannot be negative"] },
    participants: [{ type: mongoose.Schema.Types.ObjectId, ref: "student" }],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin" },
    assignedTeacher: [{ type: mongoose.Schema.Types.ObjectId, ref: "Teacher" }],
    assignedCoordinators: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Coordinator",
    },
    totalCollected: {
      type: Number,
      default: 0,
    },

    donationOpen: {
      type: Boolean,
      default: true,
    },

    institution: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Institution",
      required: true,
    },

    // event based award
    startTime: { type: Date },
    endTime: { type: Date },
    calculatedHours: { type: Number, default: 0 },

    attendance: [
      {
        student: { type: mongoose.Schema.Types.ObjectId, ref: "student" },
        status: {
          type: String,
          enum: ["Present", "Absent"],
          default: "Absent",
        },
        markedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Teacher" },
        date: { type: Date, default: Date.now },
      },
    ],
    images: [
      {
        url: { type: String },
        public_id: { type: String },
        caption: { type: String, default: "" },
        uploadAt: { type: Date, default: Date.now },
      },
    ],
    status: {
      type: String,
      enum: ["Upcoming", "Ongoing", "Completed", "Cancelled"],
      default: "Upcoming",
    },
  },
  { timestamps: true }
);

export default mongoose.model("Event", eventSchema);
