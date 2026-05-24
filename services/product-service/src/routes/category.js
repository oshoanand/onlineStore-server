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
const upload = createUploader(5); // 5MB limit for category icons

// ==========================================
// 1. PUBLIC STOREFRONT ROUTES
// ==========================================
// Fetch the entire category hierarchy (Extremely fast, served from Redis)
router.get("/all/tree", getCategoryTree);

// ==========================================
// 2. ADMIN PROTECTED ROUTES
// ==========================================
router.use(requireAdmin);

router.get("/admin/all", getAllAdminCategories);

// Create a top-level category or a sub-category
router.post("/admin/create", upload.single("thumbImage"), createCategory);

// Update category details or change its parent
router.put("/admin/:id", upload.single("thumbImage"), updateCategory);

// Delete a category (Blocked if it has children)
router.delete("/admin/:id", deleteCategory);

export default router;
