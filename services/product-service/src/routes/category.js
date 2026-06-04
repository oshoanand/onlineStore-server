import express from "express";
import {
  getCategoryTree,
  createCategory,
  updateCategory,
  deleteCategory,
  getAllAdminCategories,
} from "../controllers/category.js";
import { createUploader } from "@shop/utils";
import { requireAdmin } from "../middlewares/authHeaders.js";

const router = express.Router();

// Initialize Multer uploader with a 5MB limit for category thumbnails
const upload = createUploader(5);

// ==========================================
// 1. PUBLIC STOREFRONT ROUTES
// ==========================================

// Fetch the entire category hierarchy (Extremely fast, served from Redis)
router.get("/all/tree", getCategoryTree);

// ==========================================
// 2. ADMIN PROTECTED ROUTES
// ==========================================

// Apply the admin authorization middleware to all routes below this line
router.use(requireAdmin);

// Fetch a flat list of all categories for the Admin Dashboard table
router.get("/admin/all", getAllAdminCategories);

// Create a top-level category or a sub-category (handles image upload)
router.post("/admin/create", upload.single("thumbImage"), createCategory);

// Update category details or change its parent (handles image replacement)
router.put("/admin/:id", upload.single("thumbImage"), updateCategory);

// Delete a category (Blocked automatically in controller if it has children)
router.delete("/admin/:id", deleteCategory);

export default router;
