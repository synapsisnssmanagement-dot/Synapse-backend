import express from "express";
import { alumniOnly, protect } from "../middleware/authMiddleware.js";
import { createPaymentIntent, getEventDonations, saveDonation } from "../controllers/donationController.js";

const donationRouter = express.Router();

donationRouter.post("/create-intent", protect, alumniOnly, createPaymentIntent);

donationRouter.post("/save", protect, alumniOnly, saveDonation);

donationRouter.get("/event/:eventId", protect, alumniOnly, getEventDonations);

export default donationRouter;
