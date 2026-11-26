// Isolated test environment. Starts a throwaway mongod in a temp directory
// on a free port; never reads MONGODB_URL, so it cannot touch the configured
// (possibly real) database. All fixtures are labelled SYNTHETIC.
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import express from "express";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";

process.env.JWT_SECRET = "test-only-secret-not-used-anywhere-else";

const freePort = () =>
  new Promise((resolve) => {
    const s = net.createServer().listen(0, () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

export async function startEnv() {
  const dbPath = fs.mkdtempSync(path.join(os.tmpdir(), "synapsis-test-db-"));
  const port = await freePort();
  const mongod = spawn(process.env.MONGOD_BIN || "mongod", ["--dbpath", dbPath, "--port", String(port), "--bind_ip", "127.0.0.1", "--quiet"], { stdio: "ignore" });
  const uri = `mongodb://127.0.0.1:${port}/synapsis_test`;
  for (let i = 0; i < 60; i++) {
    try {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 500 });
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  if (mongoose.connection.readyState !== 1) throw new Error("Test mongod did not start");
  if (!/^mongodb:\/\/127\.0\.0\.1:/.test(uri)) throw new Error("Refusing to test against a non-local database");
  mongoose.set("sanitizeFilter", true); // same as server.js

  const { default: opsRouter } = await import("../routes/opsRoutes.js");
  const { default: publicRouter } = await import("../routes/publicRoutes.js");
  const { default: nssRouter } = await import("../routes/nssRoutes.js");
  const app = express();
  app.use(express.json());
  app.use("/api/ops", opsRouter);
  app.use("/api/public", publicRouter);
  app.use("/api/nss", nssRouter);
  const { default: studentRouter } = await import("../routes/StudentRoutes.js");
  const { default: chatRouter } = await import("../routes/messageRoutes.js");
  app.use("/api/students", studentRouter);
  app.use("/api/chat", chatRouter);
  const server = await new Promise((r) => {
    const s = app.listen(0, () => r(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));

  return {
    base,
    async stop() {
      server.close();
      await mongoose.disconnect();
      mongod.kill("SIGTERM");
      await new Promise((r) => mongod.once("exit", r));
      fs.rmSync(dbPath, { recursive: true, force: true });
    },
  };
}

export const tokenFor = (doc, role) => jwt.sign({ id: String(doc._id), role }, process.env.JWT_SECRET, { expiresIn: "1h" });

export const client = (base) => async (method, url, token, body) => {
  const res = await fetch(base + url, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {}
  return { status: res.status, data };
};
