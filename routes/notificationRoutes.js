import express from "express";
import {
  getNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  clearAllNotifications,
} from "../controllers/notificationController.js";
import {  protect } from "../middleware/authMiddleware.js";

const notificationRoute = express.Router();

// All notifications of logged-in user
notificationRoute.get("/", protect, getNotifications);

// Mark one notification as read
notificationRoute.put("/read/:notificationId", protect, markAsRead);

// Mark all as read
notificationRoute.put("/read-all", protect, markAllAsRead);

// Delete one notification
notificationRoute.delete("/:notificationId", protect, deleteNotification);

// Delete all notifications
notificationRoute.delete("/", protect, clearAllNotifications);

export default notificationRoute;
