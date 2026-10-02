import mongoose from "mongoose";

// A help request from outside the college (an NGO, panchayat, school, care
// home) that the institution's NSS coordinators can turn into an event.
const communityRequestSchema = new mongoose.Schema(
  {
    institution: { type: mongoose.Schema.Types.ObjectId, ref: "Institution", required: true, index: true },
    orgName: { type: String, required: true, trim: true, maxlength: 120 },
    contactName: { type: String, required: true, trim: true, maxlength: 80 },
    phone: { type: String, required: true, trim: true, maxlength: 20 },
    email: { type: String, trim: true, maxlength: 120, default: "" },
    category: {
      type: String,
      enum: ["Health", "Environment", "Education", "Elderly care", "Disaster relief", "Sanitation", "Other"],
      default: "Other",
    },
    description: { type: String, required: true, trim: true, maxlength: 1500 },
    location: { type: String, required: true, trim: true, maxlength: 160 },
    preferredDate: { type: Date },
    status: { type: String, enum: ["new", "accepted", "declined"], default: "new", index: true },
    event: { type: mongoose.Schema.Types.ObjectId, ref: "Event" },
  },
  { timestamps: true }
);

export default mongoose.model("CommunityRequest", communityRequestSchema);
