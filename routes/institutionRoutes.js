import express from "express";
import {
  createInstitution,
  getAllInstitutions,
  getInstitutionById,
  updateInstitution,
  deleteInstitution,
} from "../controllers/institutionController.js";
import { protect, adminOnly } from "../middleware/authMiddleware.js";

const instituteRouter = express.Router();

// Only Admin can manage institutions
instituteRouter.post("/create", protect, adminOnly, createInstitution);
instituteRouter.get("/allinstitutebyadmin", protect, adminOnly, getAllInstitutions);
// signup
instituteRouter.get("/getallinstitutes", getAllInstitutions);
instituteRouter.get("/:id", protect, adminOnly, getInstitutionById);
instituteRouter.put("/:id", protect, adminOnly, updateInstitution);
instituteRouter.delete("/:id", protect, adminOnly, deleteInstitution);

export default instituteRouter;
