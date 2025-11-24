// import mongoose from "mongoose";

// const StudentSchema = new mongoose.Schema(
//   {
//     name: { type: String, required: true },
//     email: { type: String, required: true, unique: true },
//     phoneNumber: { type: String, required: true },
//     department: { type: String, required: true },
//     talents: { type: [String], required: true },
//     profileImage: {
//       url: { type: String },
//       public_id: { type: String },
//     },
//     role: {
//       type: String,
//       enum: ["student", "volunteer"],
//       default: "student",
//     },
//     status: {
//       type: String,
//       enum: ["pending", "active", "rejected"],
//       default: "pending",
//     },
//     graceHistory: [
//       {
//         eventId: { type: mongoose.Schema.Types.ObjectId, ref: "Event" },
//         marks: { type: Number, default: 0 },
//         date: { type: Date, default: Date.now },
//       },
//     ],
//     graceMarks: { type: Number, default: 0 },
//     password: { type: String, required: true },
//     otp: { type: Number },
//     otpExpiry: { type: Date },
//     institution: {
//       type: mongoose.Schema.Types.ObjectId,
//       ref: "Institution",
//       required: true,
//     },

//     // gracemark Recommendation
//     pendingGraceRecommendation: {
//       marks: { type: Number, default: 0 },
//       reason: { type: String, default: "" },
//       recommendedBy: {
//         type: mongoose.Schema.Types.ObjectId,
//         ref: "Coordinator",
//       },
//       assignedTeachers: [
//         { type: mongoose.Schema.Types.ObjectId, ref: "Teacher" },
//       ],
//       status: {
//         type: String,
//         enum: ["pending", "approved", "rejected"],
//         default: "pending",
//       },
//     },
//     assignedEvents: [{ type: mongoose.Schema.Types.ObjectId, ref: "Event" }],
//   },
//   { timestamps: true }
// );

// export default mongoose.model("student", StudentSchema);
import mongoose from "mongoose";

const StudentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    phoneNumber: { type: String, required: true },
    department: { type: String, required: true },
    talents: { type: [String], required: true },
    profileImage: {
      url: { type: String },
      public_id: { type: String },
    },
    role: {
      type: String,
      enum: ["student", "volunteer"],
      default: "student",
    },
    status: {
      type: String,
      enum: ["pending", "active", "rejected"],
      default: "pending",
    },
    graceHistory: [
      {
        eventId: { type: mongoose.Schema.Types.ObjectId, ref: "Event" },
        marks: { type: Number, default: 0 },
        date: { type: Date, default: Date.now },
      },
    ],
    graceMarks: { type: Number, default: 0 },
    password: { type: String, required: true },
    otp: { type: Number },
    otpExpiry: { type: Date },
    institution: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Institution",
      required: true,
    },

    // Grace mark Recommendation
    pendingGraceRecommendation: {
      type: new mongoose.Schema(
        {
          marks: { type: Number, default: 0 },
          reason: { type: String, default: "" },
          recommendedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Coordinator",
          },
          assignedTeachers: [
            { type: mongoose.Schema.Types.ObjectId, ref: "Teacher" },
          ],
          status: {
            type: String,
            enum: ["pending", "approved", "rejected"],
            default: "pending",
          },
        },
        { _id: false }
      ),
      default: null,
    },
    assignedEvents: [{ type: mongoose.Schema.Types.ObjectId, ref: "Event" }],

    // =============================
    // Volunteer Tracking & Awards
    // =============================
    totalVolunteerHours: { type: Number, default: 0 },
    awards: [
      {
        title: { type: String }, // e.g., "Bronze Volunteer"
        description: { type: String }, // e.g., "Completed 10 hours"
        date: { type: Date, default: Date.now },
      },
    ],
    level: {
      type: String,
      enum: ["Bronze", "Silver", "Gold", "Platinum"],
      default: "Bronze",
    },
  },
  { timestamps: true }
);

// add the mark
StudentSchema.pre("save", function (next) {
  this.graceMarks = this.graceHistory.reduce(
    (sum, rec) => sum + Number(rec.marks || 0),
    0
  );
  next();
});

export default mongoose.model("student", StudentSchema);
