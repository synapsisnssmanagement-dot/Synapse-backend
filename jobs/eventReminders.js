import cron from "node-cron";
import mongoose from "mongoose";
import Event from "../models/Event.js";
import { sendEmail } from "../utils/sendEmail.js";

// Finds events happening tomorrow that haven't been reminded about yet,
// emails every assigned participant and teacher, then marks the event so
// it's never reminded twice. reminderSent is reset to false whenever an
// event's date changes (see editEvent), so a rescheduled drive gets a fresh
// reminder.
export async function sendEventReminders() {
  const start = new Date();
  start.setDate(start.getDate() + 1);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setHours(23, 59, 59, 999);

  const events = await Event.find({
    // Server-built operators must be marked trusted (sanitizeFilter is on).
    date: mongoose.trusted({ $gte: start, $lte: end }),
    status: mongoose.trusted({ $in: ["Upcoming", "Ongoing"] }),
    reminderSent: false,
  })
    .populate("participants", "name email")
    .populate("assignedTeacher", "name email");

  let emailsSent = 0;

  for (const event of events) {
    const recipients = [...(event.participants || []), ...(event.assignedTeacher || [])].filter((p) => p?.email);

    const results = await Promise.allSettled(
      recipients.map((person) =>
        sendEmail(
          person.email,
          `Reminder: ${event.title} is tomorrow`,
          `Hi ${person.name || "there"}, this is a reminder that "${event.title}" is happening tomorrow at ${event.location || "the venue"}. See you there!`
        )
      )
    );
    emailsSent += results.filter((r) => r.status === "fulfilled").length;

    event.reminderSent = true;
    await event.save();
  }

  return { eventsChecked: events.length, emailsSent };
}

// Runs once a day at 8am server time.
export function scheduleEventReminders() {
  cron.schedule("0 8 * * *", () => {
    sendEventReminders().catch((error) => console.error("Event reminder job failed:", error));
  });
}
