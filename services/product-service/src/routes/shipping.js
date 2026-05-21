import express from "express";
import {
  calculateShippingCost,
  getShippingZones,
  createShippingZone,
  updateShippingZone,
  deleteShippingZone,
} from "../controllers/shipping.js";
import { requireAdmin } from "../middlewares/authHeaders.js";

const router = express.Router();

// ==========================================
// 1. PUBLIC ROUTES (Used by Checkout / Cart)
// ==========================================
// POST because we are sending a payload (city and cart total)
router.post("/public/calculate", calculateShippingCost);

// ==========================================
// 2. ADMIN PROTECTED ROUTES
// ==========================================
router.use(requireAdmin);

router.get("/admin/all", getShippingZones);
router.post("/admin/create", createShippingZone);
router.put("/admin/:id", updateShippingZone);
router.delete("/admin/:id", deleteShippingZone);

export default router;
