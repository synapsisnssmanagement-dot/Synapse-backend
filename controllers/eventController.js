// import Alumni from "../models/Alumni.js";
import { emitToInstitution } from "../sockets/io.js";
import Alumni from "../models/Alumni.js";
import Event from "../models/Event.js";
import Student from "../models/Student.js";
import cloudinary from "../utils/cloudinary.js";

// create events
export const createEvents = async (req, res) => {
  try {
    const { title, description, date, location, hours } = req.body;
    const event = await Event.create({
      title,
      description,
      date,
      location,
      hours,
      createdBy: req.admin._id,
    });
    res.status(201).json({ success: true, event });
  } catch (error) {
    console.error("eventController.js:", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
};

// get events
export const getEvents = async (req, res) => {
  try {
    const events = await Event.find().populate("participants", "name email");
    res.json({ success: true, events });
  } catch (error) {
    console.error("eventController.js:", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
};

// get all events on the table
export const getAllevents = async (req, res) => {
  try {
    const events = await Event.find().sort({ createdAt: -1 }).limit(2000);
    if (events.length == 0) {
      return res
        .status(404)
        .json({ success: false, message: "no events are found" });
    }
    res.status(200).json({ success: true, events });
  } catch (error) {
    console.error("eventController.js:", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
};

export const getAllEventsAlumniInstituition = async (req, res) => {
  try {
    const AlumniId = req.user.id;
    const Alum = await Alumni.findById(AlumniId);
    if (!Alum) {
      return res
        .status(404)
        .json({ success: false, message: "Alumni Not found" });
    }
    const instituitionId = Alum.institution;
    const InstitutionEvent = await Event.find({ institution: instituitionId })
      .sort({ createdAt: -1 })
      .limit(2000);
    res.json({ success: true, events: InstitutionEvent });
  } catch (error) {
    console.error("eventController.js:", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
};

// get events by id
export const getEventById = async (req, res) => {
  try {
    const events = await Event.findById(req.params.id, req.body, { new: true });
    if (!events) {
      return res
        .status(404)
        .json({ success: false, message: "event not found" });
    }
    res.json({ success: true, events });
  } catch (error) {
    console.error("eventController.js:", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
};

// delete Event
export const deleteEvent = async (req, res) => {
  try {
    const deleteEvent = await Event.findByIdAndDelete(req.params.id);
    if (!deleteEvent) {
      return res.status(404).json({
        success: false,
        message: "event not found",
      });
    }
    res.json({ success: true, message: "event deleted successfully" });
  } catch (error) {
    console.error("eventController.js:", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
};

// assigning student to an event by admin or super admin
export const assignStudentToEvent = async (req, res) => {
  try {
    const { studentId } = req.body;
    const events = await Event.findById(req.params.id);
    if (!events) {
      return res
        .status(404)
        .json({ success: false, message: "Event not found" });
    }
    const student = await Student.findById(studentId);
    if (!student) {
      return res
        .status(404)
        .json({ success: false, message: "student not found" });
    }

    // adding students to participants
    if (!events.participants.includes(studentId)) {
      events.participants.push(studentId);
      await events.save();
    }

    // Also add event to student's  assignedEvents key it will update both modal of student and event if not already added
    if (!student.assignedEvents.includes(events._id)) {
      student.assignedEvents.push(events._id);
      await student.save();
    }

    res.json({
      success: true,
      message: "Student assigned to event successfully",
      events,
      student,
    });
  } catch (error) {
    console.error("eventController.js:", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
};

// update event section
export const updateEvent = async (req, res) => {
  try {
    const { title, description, date, location, hours } = req.body;
    const events = await Event.findById(req.params.id);
    if (!events) {
      return res
        .status(404)
        .json({ success: false, message: "events is not found" });
    }
    if (title) {
      events.title = title || title;
    }
    if (description) {
      events.description = description || description;
    }
    if (date) {
      events.date = date || date;
    }
    if (hours) {
      events.hours = hours || hours;
    }

    await events.save();

    res.json({ success: true, message: "event updated", events });
  } catch (error) {
    console.error("eventController.js:", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
};

// get event participants
export const getEventParticipants = async (req, res) => {
  try {
    const events = await Event.findById(req.params.id).populate(
      "participants",
      "name email department"
    );
    if (!events) {
      return res
        .status(404)
        .json({ success: false, message: "Event not found" });
    }
    res.json({ success: true, participants: events.participants });
  } catch (error) {
    console.error("eventController.js:", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
};

// upload images
export const uploadEventImages = async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) {
      return res
        .status(404)
        .json({ success: false, message: "event not found" });
    }
    if (!req.files || req.files.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "no image has been uploaded" });
    }

    const uploadImages = req.files.map((file) => ({
      url: file.path,
      public_id: file.filename,
      caption: req.body.caption || "",
      uploadAt: new Date(),
    }));

    event.images.push(...uploadImages);
    await event.save();

    res.status(201).json({
      success: true,
      message: `${req.files.length} images has been uploaded`,
      images: event.images,
    });
  } catch (error) {
    console.error("eventController.js:", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
};

export const getEventImages = async (req, res) => {
  try {
    const event = await Event.findById(req.params.id).select("images");
    if (!event) {
      return res
        .status(404)
        .json({ success: false, message: "no event found" });
    }
    res.json({ success: true, images: event.images });
  } catch (error) {
    console.error("eventController.js:", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
};

// delete image
export const deleteEventImage = async (req, res) => {
  try {
    const { id, imageId } = req.params;
    const events = await Event.findById(id);
    if (!events) {
      return res
        .status(404)
        .json({ success: false, message: "event is not found" });
    }
    const image = events.images.id(imageId);
    if (!image) {
      return res
        .status(404)
        .json({ success: false, message: "image is not found" });
    }

    if (image.public_id) {
      await cloudinary.uploader.destroy(image.public_id);
    }

    image.remove();
    await events.save();
    res.status(200).json({ success: true, events });
  } catch (error) {
    console.error("eventController.js:", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
};

// get all event images (show case on the main website)
export const getAllEventImages = async (req, res) => {
  try {
    const events = await Event.find().select("title date images");
    if (!events || events.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "event not found" });
    }
    // get all images to string in an single array of object using flatMap
    const getAllImages = events.flatMap((event) =>
      event.images.map((img) => ({
        ...img.toObject(),
        eventTitle: event.title,
        eventDate: event.date,
        eventId: event._id,
      }))
    );
    res.status(200).json({ success: true, images: getAllImages });
  } catch (error) {
    console.error("eventController.js:", error);
    res.status(500).json({
      success: false,
      message: "Something went wrong. Please try again.",
    });
  }
};

// Complete Event and update students' volunteer hours & awards
// Start Event
export const startEvent = async (req, res) => {
  try {
    const eventId = req.params.id;
    const event = await Event.findById(eventId);
    if (!event) {
      return res
        .status(404)
        .json({ success: false, message: "Event not found" });
    }

    if (event.status !== "Upcoming") {
      return res.status(400).json({
        success: false,
        message: "Only upcoming events can be started",
      });
    }

    // Mark event as ongoing and set startTime
    event.status = "Ongoing";
    event.startTime = new Date();

    await event.save();
    emitToInstitution(event.institution, "event:status", { eventId: String(event._id), status: event.status });

    res.status(200).json({
      success: true,
      message: "Event started successfully",
      event,
    });
  } catch (error) {
    console.error("eventController.js:", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
};

// Complete Event
export const completeEvent = async (req, res) => {
  try {
    const eventId = req.params.id;
    const event = await Event.findById(eventId).populate("attendance.student");
    if (!event) {
      return res
        .status(404)
        .json({ success: false, message: "Event not found" });
    }

    if (event.status !== "Ongoing") {
      return res.status(400).json({
        success: false,
        message: "Only ongoing events can be completed",
      });
    }

    // Mark event as completed
    event.status = "Completed";
    event.endTime = new Date();

    // Calculate event hours (in hours)
    const start = event.startTime || event.date;
    event.calculatedHours = (
      (event.endTime - start) /
      (1000 * 60 * 60)
    ).toFixed(2);

    // Update volunteer students
    for (const att of event.attendance) {
      if (att.status === "Present") {
        const student = await Student.findById(att.student._id);
        if (student) {
          student.totalVolunteerHours += parseFloat(event.calculatedHours);

          // Level up, and award a badge only when the level actually changes
          // (this used to push a duplicate award on every completed event).
          const hours = student.totalVolunteerHours;
          const level = hours >= 50 ? "Platinum" : hours >= 26 ? "Gold" : hours >= 11 ? "Silver" : hours > 0 ? "Bronze" : null;
          const AWARDS = {
            Platinum: "Completed 50 hours",
            Gold: "Completed 26 hours",
            Silver: "Completed 11 hours",
            Bronze: "Started volunteering",
          };
          if (level && student.level !== level) {
            student.level = level;
            student.awards.push({ title: `${level} Volunteer`, description: AWARDS[level] });
          }

          await student.save();
        }
      }
    }

    await event.save();
    emitToInstitution(event.institution, "event:status", { eventId: String(event._id), status: event.status });

    res.status(200).json({
      success: true,
      message: "Event completed successfully and students updated",
      event,
    });
  } catch (error) {
    console.error("eventController.js:", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
};
