import { stripe } from "../utils/stripe.js";
import Event from "../models/Event.js";
import Donation from "../models/Donation.js";

const MAX_DONATION = 1_000_000;

// 1️⃣ Create Stripe Payment Intent
export const createPaymentIntent = async (req, res) => {
  try {
    // console.log("🔵 BODY:", req.body);
    // console.log("🔵 USER:", req.user);
    // console.log("🔵 STRIPE:", process.env.STRIPE_SECRET_KEY ? "LOADED" : "MISSING");

    const { amount, eventId } = req.body;

    if (
      typeof amount !== "number" ||
      !Number.isFinite(amount) ||
      amount <= 0 ||
      amount > MAX_DONATION
    ) {
      return res.status(400).json({
        message: `Amount must be a number between 1 and ${MAX_DONATION}`,
      });
    }

    const event = await Event.findById(eventId);
    if (!event)
      return res.status(404).json({ message: "Event not found" });

    if (!event.donationOpen)
      return res.status(400).json({ message: "Donations closed" });

    const intent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100),
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
// The amount and event are read back from the PaymentIntent, never from the
// request body: the client controls the body, so trusting it would let a donor
// pay one amount and have another recorded.
export const saveDonation = async (req, res) => {
  try {
    const { paymentId, message } = req.body;

    if (!paymentId || typeof paymentId !== "string") {
      return res.status(400).json({ message: "paymentId is required" });
    }

    const paymentIntent = await stripe.paymentIntents.retrieve(paymentId);

    if (paymentIntent.status !== "succeeded") {
      return res.status(400).json({
        message: "Payment verification failed. Not saving donation.",
      });
    }

    // The payer must be the caller, so one alumni cannot claim another's payment.
    if (paymentIntent.metadata?.alumniId !== req.user._id.toString()) {
      return res
        .status(403)
        .json({ message: "This payment belongs to another account" });
    }

    const eventId = paymentIntent.metadata?.eventId;
    if (!eventId) {
      return res
        .status(400)
        .json({ message: "Payment is not linked to an event" });
    }

    const amount = paymentIntent.amount / 100;

    const donation = await Donation.create({
      eventId,
      alumniId: req.user._id,
      amount,
      paymentId,
      message,
    });

    await Event.findByIdAndUpdate(eventId, {
      $inc: { totalCollected: amount },
    });

    res.json({ message: "Donation saved successfully", donation });
  } catch (error) {
    // Unique index on paymentId: the payment was already recorded, so the
    // event total must not be incremented a second time.
    if (error.code === 11000) {
      return res
        .status(409)
        .json({ message: "This payment has already been recorded" });
    }
    console.error("saveDonation failed:", error);
    res.status(500).json({ message: "Could not save donation" });
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
