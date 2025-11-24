import Institution from "../models/Institution.js";

// CREATE new institution
export const createInstitution = async (req, res) => {
  try {
    const { name, address, contactEmail, phoneNumber } = req.body;

    // Check if institution already exists by name
    const existingInstitution = await Institution.findOne({ name });
    if (existingInstitution) {
      return res.status(400).json({
        success: false,
        message: "Institution already exists",
      });
    }

    const newInstitution = new Institution({
      name,
      address,
      contactEmail,
      phoneNumber,
    });

    await newInstitution.save();

    res.status(201).json({
      success: true,
      message: "Institution created successfully",
      data: newInstitution,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error creating institution",
      error: error.message,
    });
  }
};

// GET all institutions
export const getAllInstitutions = async (req, res) => {
  try {
    const institutions = await Institution.find().sort({ createdAt: -1 });
    res.status(200).json({ success: true, institutions });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch institutions",
      error: error.message,
    });
  }
};

// GET single institution by ID
export const getInstitutionById = async (req, res) => {
  try {
    const institution = await Institution.findById(req.params.id);
    if (!institution)
      return res
        .status(404)
        .json({ success: false, message: "Institution not found" });
    res.status(200).json({ success: true, institution });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching institution",
      error: error.message,
    });
  }
};

// UPDATE institution
export const updateInstitution = async (req, res) => {
  try {
    const institution = await Institution.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    );
    if (!institution)
      return res
        .status(404)
        .json({ success: false, message: "Institution not found" });
    res
      .status(200)
      .json({ success: true, message: "Institution updated", institution });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error updating institution",
      error: error.message,
    });
  }
};

// DELETE institution
export const deleteInstitution = async (req, res) => {
  try {
    const institution = await Institution.findByIdAndDelete(req.params.id);
    if (!institution)
      return res
        .status(404)
        .json({ success: false, message: "Institution not found" });
    res
      .status(200)
      .json({ success: true, message: "Institution deleted successfully" });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error deleting institution",
      error: error.message,
    });
  }
};
