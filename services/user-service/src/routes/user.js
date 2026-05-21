import express from "express";
import { register, login } from "../controllers/auth.js";
import {
  getProfile,
  addAddress,
  registerDeviceToken,
  getInternalUser,
  getInternalAdmins,
} from "../controllers/user.js";
import { requireAuth } from "../middlewares/authHeaders.js";
import { requireInternalAuth } from "@shop/utils"; // 🚨 NEW: Shared internal middleware
import {
  validate,
  loginValidationRules,
  registerValidationRules,
} from "../middlewares/authValidator.js";

import blogRoutes from "./blog.js";

const router = express.Router();

// ==========================================
// 0. INTERNAL MICROSERVICE ROUTES
// ==========================================
// 🚨 MUST be placed BEFORE the requireAuth middleware because these
// rely on the x-internal-secret header, not a user JWT.
// Note: Place `/internal/admins` BEFORE `/internal/:id` to avoid route collision.
router.get("/internal/admins", requireInternalAuth, getInternalAdmins);
router.get("/internal/:id", requireInternalAuth, getInternalUser);

// ==========================================
// 1. PUBLIC ROUTES
// ==========================================
router.post("/auth/register", registerValidationRules, validate, register);
router.post("/auth/login", loginValidationRules, validate, login);

// 🚨 FIX: Actually mount the blog routes that were imported
router.use("/blogs", blogRoutes);

// ==========================================
// 2. PROTECTED ROUTES (Requires JWT)
// ==========================================
// Apply the authentication middleware only to the routes below this line.
// This decodes the JWT and populates `req.user` for all subsequent routes.
router.use(requireAuth);

router.get("/profile", getProfile);
router.post("/addresses", addAddress);
router.post("/device-token", registerDeviceToken);

// ==========================================
// 3. 🚨 THE "CATCH-ALL" 404 HANDLER
// ==========================================
// CRITICAL FIX: This is now safely at the absolute bottom of the file.
router.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `User Service Route Not Found: ${req.method} ${req.originalUrl}`,
  });
});

export default router;
