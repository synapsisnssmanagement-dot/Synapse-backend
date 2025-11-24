import { stripe } from "../utils/stripe.js";
import Event from "../models/Event.js";
import Donation from "../models/Donation.js";

// 1️⃣ Create Stripe Payment Intent
export const createPaymentIntent = async (req, res) => {
  try {
    // console.log("🔵 BODY:", req.body);
    // console.log("🔵 USER:", req.user);
    // console.log("🔵 STRIPE:", process.env.STRIPE_SECRET_KEY ? "LOADED" : "MISSING");

    const { amount, eventId } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ message: "Invalid amount" });
    }

    const event = await Event.findById(eventId);
    if (!event)
      return res.status(404).json({ message: "Event not found" });

    if (!event.donationOpen)
      return res.status(400).json({ message: "Donations closed" });

    const intent = await stripe.paymentIntents.create({
      amount: amount * 100,
      currency: "inr",
      payment_method_types: ["card"],
      metadata: {
        eventId,
        alumniId: req.user?._id?.toString() || "unknown",
        amount: String(amount),
      },
    });

    console.log("✅ INTENT_CREATED:", intent.id);

    res.json({ clientSecret: intent.client_secret });
  } catch (error) {
    console.error("❌ STRIPE ERROR:", error);
    res.status(500).json({ error: error.message });
  }
};

// 2️⃣ Save Donation After Payment
export const saveDonation = async (req, res) => {
  try {
    const { eventId, amount, paymentId, message } = req.body;

    // verify payment
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentId);

    if (paymentIntent.status !== "succeeded") {
      return res.status(400).json({
        error: "Payment verification failed. Not saving donation.",
      });
    }

    // save donation
    await Donation.create({
      eventId,
      alumniId: req.user._id,
      amount,
      paymentId,
      message,
    });

    // update event total
    await Event.findByIdAndUpdate(eventId, {
      $inc: { totalCollected: amount },
    });

    res.json({ message: "Donation saved successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};


// 3️⃣ Coordinator View Donors
export const getEventDonations = async (req, res) => {
  try {
    const { eventId } = req.params;

    const donations = await Donation.find({ eventId })
      .populate("alumniId", "name email")  // show only needed fields
      .sort({ createdAt: -1 });

    res.json(donations);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
