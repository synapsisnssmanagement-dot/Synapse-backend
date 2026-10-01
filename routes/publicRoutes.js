import express from "express";
import { verifyCertificate } from "../controllers/publicController.js";

const publicRouter = express.Router();

publicRouter.get("/verify/:certId", verifyCertificate);

export default publicRouter;
