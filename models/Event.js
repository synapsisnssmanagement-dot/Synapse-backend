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

    donationGoal: {
      type: Number,
      default: 0,
    },

    reminderSent: {
      type: Boolean,
      default: false,
    },

    // "special_camp" is NSS's residential camp (usually 7 days); attending
    // one is required for the NSS certificate, alongside 240 hours.
    type: { type: String, enum: ["regular", "special_camp"], default: "regular" },
    endDate: { type: Date },

    // Skills the coordinator wants for this drive; used to rank volunteers.
    requiredSkills: { type: [String], default: [] },

    // Venue pin for location-checked check-in. Unset means no location check.
    geo: {
      lat: { type: Number },
      lng: { type: Number },
      radius: { type: Number, default: 300 }, // metres
    },

    // Outcomes recorded after the drive, e.g. { metric: "Trees planted", value: 120, unit: "trees" }.
    impact: [
      {
        metric: { type: String, required: true },
        value: { type: Number, required: true, min: 0 },
        unit: { type: String, default: "" },
      },
    ],

    // Special camp: daily roll call and the camp diary.
    campDays: [
      {
        date: { type: Date, required: true },
        present: [{ type: mongoose.Schema.Types.ObjectId, ref: "student" }],
      },
    ],
    campDiary: [
      {
        date: { type: Date, default: Date.now },
        title: { type: String, required: true },
        body: { type: String, required: true },
        authorName: { type: String },
      },
    ],

    communityRequest: { type: mongoose.Schema.Types.ObjectId, ref: "CommunityRequest" },

    donationOpen: {
      type: Boolean,
      default: true,
    },

    institution: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Institution",
      required: true,
      index: true,
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
