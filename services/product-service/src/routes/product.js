import express from "express";
import {
  getPublicProducts,
  getPublicProductBySlug,
  getRelatedProducts,
  getGroupedProducts,
  getAdminProducts,
  getProductById,
  createProduct,
  updateProduct,
  updateProductStatus,
  deleteProduct,
} from "../controllers/product.js";
import { createUploader } from "@shop/utils";
import { requireAdmin } from "../middlewares/authHeaders.js";

const router = express.Router();
// Allow up to 10MB for uploads
const upload = createUploader(10);

// ==========================================
// 1. PUBLIC STOREFRONT ROUTES
// ==========================================
//  Fetch multiple tagged carousels at once for the Homepage
router.get("/public/grouped", getGroupedProducts);
// Advanced filtering, sorting, sentence search, and pagination
router.get("/public/all", getPublicProducts);
// SEO-friendly product fetching by slug
router.get("/public/slug/:slug", getPublicProductBySlug);
// Cross-selling: Get related products based on categories
router.get("/public/:id/related", getRelatedProducts);

// ==========================================
// 2. ADMIN PROTECTED ROUTES
// ==========================================
// Protect all routes below this line
router.use(requireAdmin);

// Fetch all products for the admin dashboard (includes inactive/drafts)
router.get("/admin/all", getAdminProducts);

// Fetch a single product for the edit screen (Uncached)
router.get("/admin/:id", getProductById);

// Handle multiple fields for MinIO upload
router.post(
  "/admin/create",
  upload.fields([
    { name: "thumbImage", maxCount: 1 },
    { name: "imageArray", maxCount: 4 },
  ]),
  createProduct,
);

// Update product (replaces images if new ones are provided)
router.put(
  "/admin/:id",
  upload.fields([
    { name: "thumbImage", maxCount: 1 },
    { name: "imageArray", maxCount: 4 },
  ]),
  updateProduct,
);

// Quick toggle for status (ACTIVE/INACTIVE/OUT_OF_STOCK) without full payload
router.patch("/admin/:id/status", updateProductStatus);

// Delete product
router.delete("/admin/:id", deleteProduct);

export default router;
