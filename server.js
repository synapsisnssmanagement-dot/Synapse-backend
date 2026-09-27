import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import passport from "passport";
import session from "express-session";
import { ConnectDb } from "./configs/db.js";
import { Server } from "socket.io";
import http from "http";

// Import routes
import router from "./routes/adminRoutes.js";
import eventRouter from "./routes/eventRoutes.js";
import authRouter from "./routes/authRoutes.js";
import studentRouter from "./routes/StudentRoutes.js";
import alumniRouter from "./routes/alumniRoutes.js";
import teacherRoute from "./routes/teacherRoutes.js";
import coordinatorRoute from "./routes/coordinatorRoute.js";
import otpRouter from "./routes/otpRoute.js";
import instituteRouter from "./routes/institutionRoutes.js";
import airouter from "./routes/aiRoute.js";
import messagerouter from "./routes/messageRoutes.js";

import "./configs/passport.js";
import notificationRoute from "./routes/notificationRoutes.js";
import donationRouter from "./routes/donationRoutes.js";
import mentorshipRouter from "./routes/mentorshipRoutes.js";
import mentorshipMessage from "./routes/mentorshipMessageRoutes.js";
import MentorshipMessage from "./models/MentorshipMessage.js";
import Mentorship from "./models/Mentorship.js";
import { socketAuth } from "./sockets/socketAuth.js";

dotenv.config();
const port = process.env.PORT || 5000;

const app = express();
app.use(express.json());

// 🚀 UPDATED CORS FOR VERCEL FRONTEND + LOCAL DEV
const allowedOrigins = [
  "https://synapse-three-rho.vercel.app", // your frontend
  "http://localhost:5173", // local dev
  "https://synapsenssmanagement.vercel.app",
];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  })
);

// Passport OAuth
app.use(
  session({
    secret: process.env.SESSION_SECRET || "your_secret_key",
    resave: false,
    saveUninitialized: true,
  })
);
app.use(passport.initialize());
app.use(passport.session());

// API Routes
app.use("/api/admin", router);
app.use("/api/chat", messagerouter);
app.use("/api/events", eventRouter);
app.use("/api/auth", authRouter);
app.use("/api/students", studentRouter);
app.use("/api/alumni", alumniRouter);
app.use("/api/teacher", teacherRoute);
app.use("/api/coordinator", coordinatorRoute);
app.use("/api/institution", instituteRouter);
app.use("/api/otp", otpRouter);
app.use("/api/ai", airouter);
app.use("/api/notification", notificationRoute);
app.use("/api/donations", donationRouter);
app.use("/api/mentorship", mentorshipRouter);
app.use("/api/mentorshipmessage", mentorshipMessage);

ConnectDb()
  .then(() => {
    console.log("✅ MongoDB connected successfully");

    const server = http.createServer(app);

    // 🚀 UPDATED SOCKET.IO CORS
    const io = new Server(server, {
      cors: {
        origin: allowedOrigins,
        methods: ["GET", "POST"],
        credentials: true,
      },
    });

    app.set("io", io);

    import("./sockets/socketAuth.js").then(({ socketAuth }) => {
      io.use(socketAuth);

      io.on("connection", (socket) => {
        console.log("🟢 Socket connected:", socket.id, socket.user?.name);

        // Event chat is per-institution, so a socket may only touch rooms
        // belonging to its own institution.
        const ownsInstitution = (institutionId) =>
          Boolean(institutionId) && socket.user?.institution === institutionId;

        socket.on("join_room", ({ institutionId, eventId }) => {
          if (!eventId || !ownsInstitution(institutionId)) {
            return socket.emit("error_message", "Not allowed to join this room");
          }
          socket.join(`institution:${institutionId}:event:${eventId}`);
        });

        socket.on("leave_room", ({ institutionId, eventId }) => {
          if (!eventId || !institutionId) return;
          socket.leave(`institution:${institutionId}:event:${eventId}`);
        });

        socket.on(
          "send_message",
          async ({ eventId, institutionId, content }) => {
            if (!eventId || !content) return;
            if (!ownsInstitution(institutionId)) {
              return socket.emit(
                "error_message",
                "Not allowed to post in this room"
              );
            }

            try {
              const { default: Message } = await import("./models/Message.js");

              const message = await Message.create({
                eventId,
                institutionId,
                sender: {
                  id: socket.user.id,
                  name: socket.user.name,
                  role: socket.user.role,
                },
                content,
              });

              const room = `institution:${institutionId}:event:${eventId}`;
              io.to(room).emit("new_message", message);
            } catch (err) {
              console.error("send_message failed:", err.message);
              socket.emit("error_message", "Could not send message");
            }
          }
        );

        socket.on("disconnect", () => {
          console.log("🔴 Socket disconnected:", socket.id);
        });
      });
    });

    // ===============================
    // 🟦 Mentorship Private Chat
    // ===============================
    const mentorshipIO = io.of("/mentorship-chat");

    mentorshipIO.use(socketAuth);

    mentorshipIO.on("connection", (socket) => {
      console.log("🟢 Mentorship Chat Connected:", socket.id);

      // A mentorship thread is private to its mentor and mentee, so membership
      // is checked against the Mentorship document rather than trusting the id.
      const isParticipant = async (mentorshipId) => {
        const mentorship = await Mentorship.findById(mentorshipId).select(
          "mentor mentee"
        );
        if (!mentorship) return false;
        const me = socket.user.id;
        return (
          mentorship.mentor?.toString() === me ||
          mentorship.mentee?.toString() === me
        );
      };

      socket.on("joinMentorship", async ({ mentorshipId }) => {
        if (!mentorshipId) return;
        try {
          if (!(await isParticipant(mentorshipId))) {
            return socket.emit("error_message", "Not part of this mentorship");
          }
          socket.join(mentorshipId);
        } catch (err) {
          console.error("joinMentorship failed:", err.message);
          socket.emit("error_message", "Could not join mentorship chat");
        }
      });

      socket.on("sendMentorMessage", async ({ mentorshipId, message }) => {
        if (!mentorshipId || !message) return;

        try {
          if (!(await isParticipant(mentorshipId))) {
            return socket.emit("error_message", "Not part of this mentorship");
          }

          const savedMessage = await MentorshipMessage.create({
            mentorship: mentorshipId,
            senderId: socket.user.id,
            senderRole: socket.user.role,
            message,
          });

          mentorshipIO.to(mentorshipId).emit("newMentorMessage", savedMessage);
        } catch (err) {
          console.error("sendMentorMessage failed:", err.message);
          socket.emit("error_message", "Could not send message");
        }
      });

      socket.on("disconnect", () => {
        console.log("🔴 Mentorship Chat Disconnected:", socket.id);
      });
    });

    server.listen(port, () => {
      console.log(`🚀 Server running on port ${port}`);
    });
  })
  .catch((error) => {
    console.error("❌ Failed to start server:", error.message);
  });
