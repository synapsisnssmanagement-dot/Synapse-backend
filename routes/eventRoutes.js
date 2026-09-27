import express from "express";
import {
  assignStudentToEvent,
  completeEvent,
  createEvents,
  deleteEvent,
  deleteEventImage,
  getAllEventImages,
  getAllevents,
  getEventById,
  getEventImages,
  getEventParticipants,
  getEvents,
  startEvent,
  updateEvent,
  uploadEventImages,
} from "../controllers/eventController.js";
import {
  coordinatorOnly,
  protect,
  teacherOnly,
} from "../middleware/authMiddleware.js";
import upload from "../middleware/uploadMiddleware.js";

const eventRouter = express.Router();

eventRouter.post("/addevent", protect, createEvents);

eventRouter.get("/getevents", getEvents);

eventRouter.get("/getallevent", getAllevents);

eventRouter.get("/geteventsbyid/:id", getEventById);

eventRouter.delete("/deleteevent/:id", protect, coordinatorOnly, deleteEvent);

eventRouter.post(
  "/assigntoevent/:id",
  protect,
  coordinatorOnly,
  assignStudentToEvent
);

eventRouter.get("/participantsofevents/:id", protect, getEventParticipants);

eventRouter.put("/updateevent/:id", protect, coordinatorOnly, updateEvent);

eventRouter.post(
  "/:id/uploadimages",
  upload.array("images", 10),
  protect,
  teacherOnly,
  uploadEventImages
);

eventRouter.get("/:id/images", getEventImages);

eventRouter.delete(
  "/:id/images/:imageId",
  protect,
  teacherOnly,
  deleteEventImage
);

eventRouter.get("/getalleventimage", getAllEventImages);

eventRouter.put("/:id/start", protect, coordinatorOnly, startEvent);

eventRouter.put("/:id/complete", protect, coordinatorOnly, completeEvent);

export default eventRouter;
