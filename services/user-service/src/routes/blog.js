import express from "express";
import {
  getAdminArticles,
  createArticle,
  deleteArticle,
  updateArticleStatus,
  getPendingComments,
  moderateComment,
  updateArticle,
  getArticleById,
} from "../controllers/blog.js";

import { createUploader } from "@shop/utils";

// Import your admin authorization middleware
// Adjust the path if your middleware file is named differently (e.g., authHeaders.js)
import { requireAdmin } from "../middlewares/authHeaders.js";

const router = express.Router();

// Initialize the uploader (memory storage, max 5MB)
const upload = createUploader(5);

// ==========================================
// 1. SECURITY MIDDLEWARE
// ==========================================
// Apply the admin middleware to all routes in this file.
// This ensures only users with the ADMIN role can create/delete/moderate.
router.use(requireAdmin);

// ==========================================
// 2. ARTICLE ROUTES (Static)
// ==========================================
router.get("/admin/all", getAdminArticles);
router.post("/admin/create", upload.single("media"), createArticle);

// ==========================================
// 3. COMMENT ROUTES
// ==========================================
// CRITICAL: These must be defined BEFORE the parameterized article routes (/:id)
// Otherwise, Express will see "/admin/comments" and think "comments" is an Article ID!
router.get("/admin/comments", getPendingComments);
router.patch("/comments/:id/moderate", moderateComment);

// ==========================================
// 4. ARTICLE ROUTES (Parameterized)
// ==========================================

// CRITICAL: These must remain at the bottom so "admin" or "comments" aren't treated as an ID

router.get("/:id", getArticleById);
router.patch("/:id/status", updateArticleStatus);
router.delete("/:id", deleteArticle);
router.put("/:id", upload.single("media"), updateArticle);

export default router;
