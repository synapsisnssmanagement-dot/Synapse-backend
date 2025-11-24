import mongoose from "mongoose";

const donationSchema = new mongoose.Schema({
  eventId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Event",
    required: true,
  },
  alumniId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Alumni",
    required: true,
  },
  amount: { type: Number, required: true },
  paymentId: { type: String, required: true },
  message: { type: String, default: "" },
  status: { type: String, default: "succeeded" },
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.model("Donation", donationSchema);
