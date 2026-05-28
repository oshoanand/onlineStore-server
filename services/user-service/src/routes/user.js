// import express from "express";
// import { register, login } from "../controllers/auth.js";
// import {
//   getProfile,
//   addAddress,
//   updateAddress,
//   deleteAddress,
//   registerDeviceToken,
//   getInternalUser,
//   getInternalAdmins,
// } from "../controllers/user.js";
// import { requireAuth } from "../middlewares/authHeaders.js";
// import { requireInternalAuth } from "@shop/utils";
// import {
//   validate,
//   loginValidationRules,
//   registerValidationRules,
// } from "../middlewares/authValidator.js";

// import blogRoutes from "./blog.js";

// const router = express.Router();

// // ==========================================
// // 0. INTERNAL MICROSERVICE ROUTES
// // ==========================================
// // 🚨 MUST be placed BEFORE the requireAuth middleware because these
// // rely on the x-internal-secret header, not a user JWT.
// // Note: Place `/internal/admins` BEFORE `/internal/:id` to avoid route collision.
// router.get("/internal/admins", requireInternalAuth, getInternalAdmins);
// router.get("/internal/:id", requireInternalAuth, getInternalUser);

// // ==========================================
// // 1. PUBLIC ROUTES
// // ==========================================
// router.post("/auth/register", registerValidationRules, validate, register);
// router.post("/auth/login", loginValidationRules, validate, login);

// //  Actually mount the blog routes that were imported
// router.use("/blogs", blogRoutes);

// // ==========================================
// // 2. PROTECTED ROUTES (Requires JWT)
// // ==========================================
// // Apply the authentication middleware only to the routes below this line.
// // This decodes the JWT and populates `req.user` for all subsequent routes.
// router.use(requireAuth);

// router.get("/profile", getProfile);
// router.post("/addresses", addAddress);
// router.put("/addresses/:id", updateAddress);
// router.delete("/addresses/:id", deleteAddress);
// router.post("/device-token", registerDeviceToken);

// // ==========================================
// // 3. 🚨 THE "CATCH-ALL" 404 HANDLER
// // ==========================================
// // This is now safely at the absolute bottom of the file.
// router.use((req, res) => {
//   res.status(404).json({
//     success: false,
//     message: `User Service Route Not Found: ${req.method} ${req.originalUrl}`,
//   });
// });

// export default router;

import express from "express";
import { register, login } from "../controllers/auth.js";
import {
  getProfile,
  addAddress,
  updateAddress,
  deleteAddress,
  registerDeviceToken,
  getInternalUser,
  getInternalAdmins,
} from "../controllers/user.js";
import { requireAuth } from "../middlewares/authHeaders.js";
import { requireInternalAuth } from "@shop/utils";
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
// Multi-path arrays ensure safety whether the incoming internal url has prefixes stripped or not.
router.get(
  ["/internal/admins", "/api/users/internal/admins"],
  requireInternalAuth,
  getInternalAdmins,
);

router.get(
  ["/internal/:id", "/api/users/internal/:id"],
  requireInternalAuth,
  getInternalUser,
);

// ==========================================
// 1. PUBLIC ROUTES
// ==========================================
router.post("/auth/register", registerValidationRules, validate, register);
router.post("/auth/login", loginValidationRules, validate, login);

// Mount public blog routes
router.use("/blogs", blogRoutes);

// ==========================================
// 2. PROTECTED ROUTES (Requires JWT)
// ==========================================
// Apply the authentication middleware only to the routes below this line.
router.use(requireAuth);

router.get("/profile", getProfile);
router.post("/addresses", addAddress);
router.put("/addresses/:id", updateAddress);
router.delete("/addresses/:id", deleteAddress);

// 🚨 FIX: Supports both standard endpoints and the explicit PWA frontend PUSH sync path
router.post(["/device-token", "/fcm/save-fcm"], registerDeviceToken);

// ==========================================
// 3. THE "CATCH-ALL" 404 HANDLER
// ==========================================
router.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `User Service Route Not Found: ${req.method} ${req.originalUrl}`,
  });
});

export default router;
