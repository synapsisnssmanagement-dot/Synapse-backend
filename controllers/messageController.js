import Message from "../models/Message.js";
import Event from "../models/Event.js";

export const getMessagesForEvent = async (req, res) => {
  try {
    const { eventId } = req.params;
    const messages = await Message.find({ eventId })
      .sort({ createdAt: 1 })
      .limit(200)
      .lean();
    return res.json({ success: true, messages });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: err.message });
  }
};


export const sendMessage = async (req, res) => {
  try {
    const { eventId, content } = req.body;

    if (!eventId || !content) {
      return res.status(400).json({
        success: false,
        message: "eventId and content are required.",
      });
    }

    // ✅ Get event and validate
    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({
        success: false,
        message: "Event not found.",
      });
    }

    // ✅ Use institutionId from the event
    const institutionId = event.institution;

    // ✅ Create message
    const message = await Message.create({
      eventId,
      institutionId,
      sender: {
        id: req.user?._id || null,
        name: req.user?.name || "Unknown",
        role: req.user?.role || "Unknown",
      },
      content,
    });

    // ✅ Return the saved message
    res.status(201).json({
      success: true,
      message,
    });
  } catch (error) {
    console.error("Error sending message:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};
