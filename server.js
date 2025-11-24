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

        socket.on("join_room", ({ institutionId, eventId }) => {
          if (!institutionId || !eventId) return;
          const room = `institution:${institutionId}:event:${eventId}`;
          socket.join(room);
        });

        socket.on("leave_room", ({ institutionId, eventId }) => {
          const room = `institution:${institutionId}:event:${eventId}`;
          socket.leave(room);
        });

        socket.on(
          "send_message",
          async ({ eventId, institutionId, content }) => {
            if (!eventId || !institutionId || !content) return;

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

      socket.on("joinMentorship", ({ mentorshipId }) => {
        if (!mentorshipId) return;
        socket.join(mentorshipId);
      });

      socket.on("sendMentorMessage", async ({ mentorshipId, message }) => {
        if (!mentorshipId || !message) return;

        const savedMessage = await MentorshipMessage.create({
          mentorship: mentorshipId,
          senderId: socket.user.id,
          senderRole: socket.user.role,
          message,
        });

        mentorshipIO.to(mentorshipId).emit("newMentorMessage", savedMessage);
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
