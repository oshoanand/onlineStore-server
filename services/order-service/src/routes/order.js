import express from "express";
import {
  createOrder,
  getUserOrders,
  getOrderById,
  getAllOrdersAdmin,
  updateOrderStatus,
  verifyCourierDelivery,
  getInternalOrder, // 🚨 NEW: Added for service-to-service communication
} from "../controllers/order.js";
import { requireAuth, requireAdmin } from "../middlewares/authHeaders.js";
import { requireInternalAuth } from "@shop/utils"; // 🚨 NEW: Shared internal middleware

const router = express.Router();

// ==========================================
// 0. INTERNAL MICROSERVICE ROUTES
// ==========================================
// 🚨 MUST be placed BEFORE `router.use(requireAuth)` because these
// rely on the x-internal-secret header, not a user JWT.
router.get("/internal/:id", requireInternalAuth, getInternalOrder);

// ==========================================
// 1. STANDARD PROTECTED ROUTES (Requires JWT)
// ==========================================
// Apply the authentication middleware only to the routes below this line.
router.use(requireAuth);

router.post("/", createOrder);
router.get("/", getUserOrders);

// ==========================================
// 2. ADMIN ROUTES
// ==========================================
// 🚨 MUST be placed before /:id so Express doesn't treat "admin" as an ID parameter
router.get("/admin/all", requireAdmin, getAllOrdersAdmin);
router.patch("/admin/:id/status", requireAdmin, updateOrderStatus);

// ==========================================
// 3. COURIER ROUTES
// ==========================================
// In a real app, you might have a requireCourier middleware, but requireAuth handles basic JWT
router.post("/courier/:id/verify", verifyCourierDelivery);

// ==========================================
// 4. DYNAMIC ROUTES
// ==========================================
// 🚨 MUST be placed after all specific paths like /admin/... and /courier/...
router.get("/:id", getOrderById);

// ==========================================
// 5. 🚨 THE "CATCH-ALL" 404 HANDLER
// ==========================================
// Ensures that mismatched routes return a clean JSON error instead of an HTML page.
router.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Order Service Route Not Found: ${req.method} ${req.originalUrl}`,
  });
});

export default router;
