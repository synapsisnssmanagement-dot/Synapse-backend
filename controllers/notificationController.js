import Notification from "../models/Notification.js";

// ==============================
// GET ALL NOTIFICATIONS
// ==============================
export const getNotifications = async (req, res) => {
  try {
    const userId = req.user._id;

    let userModel;

    // Volunteers are students
    if (req.user.role === "volunteer" || req.user.role === "student") {
      userModel = "Student";
    } 
    // Teachers, admins, coordinators
    else {
      userModel =
        req.user.role.charAt(0).toUpperCase() + req.user.role.slice(1);
    }

    const notifications = await Notification.find({
      user: userId,
      userModel: userModel,
    }).sort({ createdAt: -1 });

    return res.json({
      success: true,
      notifications,
    });
  } catch (error) {
    console.error("Get Notifications Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==============================
// MARK A SINGLE NOTIFICATION AS READ
// ==============================
export const markAsRead = async (req, res) => {
  try {
    const { notificationId } = req.params;

    // Ensure user owns this notification
    const notification = await Notification.findOne({
      _id: notificationId,
      user: req.user._id,
    });

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: "Notification not found or unauthorized",
      });
    }

    notification.read = true;
    await notification.save();

    return res.json({
      success: true,
      message: "Notification marked as read",
    });
  } catch (error) {
    console.error("Mark Notification Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==============================
// MARK ALL NOTIFICATIONS AS READ
// ==============================
export const markAllAsRead = async (req, res) => {
  try {
    await Notification.updateMany(
      { user: req.user._id },
      { $set: { read: true } }
    );

    return res.json({
      success: true,
      message: "All notifications marked as read",
    });
  } catch (error) {
    console.error("Mark All Read Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==============================
// DELETE SINGLE NOTIFICATION
// ==============================
export const deleteNotification = async (req, res) => {
  try {
    const { notificationId } = req.params;

    const deleted = await Notification.findOneAndDelete({
      _id: notificationId,
      user: req.user._id, // extra security
    });

    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: "Notification not found or unauthorized",
      });
    }

    return res.json({
      success: true,
      message: "Notification deleted",
    });
  } catch (error) {
    console.error("Delete Notification Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==============================
// DELETE ALL NOTIFICATIONS
// ==============================
export const clearAllNotifications = async (req, res) => {
  try {
    await Notification.deleteMany({ user: req.user._id });

    return res.json({
      success: true,
      message: "All notifications cleared",
    });
  } catch (error) {
    console.error("Clear All Notifications Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};
