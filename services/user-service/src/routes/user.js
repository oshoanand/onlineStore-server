import express from "express";
import { register, login } from "../controllers/auth.js";
import {
  getProfile,
  getUsersList,
  createUser,
  updateUser,
  deleteUser,
  addAddress,
  updateAddress,
  deleteAddress,
  registerDeviceToken,
  getInternalUser,
  getInternalAdmins,
  updateProfileImage,
  updateProfileDetails,
  getUserById,
} from "../controllers/user.js";
import {
  getCustomersList,
  updateCustomerStatus,
} from "../controllers/customer.js";
import { requireAuth, requireAdmin } from "../middlewares/authHeaders.js";
import { requireInternalAuth, createUploader } from "@shop/utils";

import {
  validate,
  loginValidationRules,
  registerValidationRules,
} from "../middlewares/authValidator.js";

import blogRoutes from "./blog.js";
import supportRoutes from "./support.js";

const router = express.Router();

const upload = createUploader(5);

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
router.use("/support", supportRoutes);

router.get("/profile", getProfile);
router.put("/profile/update-details/:id", updateProfileDetails);

router.put(
  "/profile/update-image/:id",
  upload.single("profileImage"),
  updateProfileImage,
);

router.post("/addresses", addAddress);
router.put("/addresses/:id", updateAddress);
router.delete("/addresses/:id", deleteAddress);

router.get("/admin/list", requireAdmin, getUsersList);
router.post("/admin/create", requireAdmin, createUser);
router.delete("/admin/user/:id", requireAdmin, deleteUser);
router.put("/admin/user/:id", requireAdmin, updateUser);

router.get("/admin/customers", requireAdmin, getCustomersList);
router.put("/admin/customers/:id/status", requireAdmin, updateCustomerStatus);

// Supports both standard endpoints and the explicit PWA frontend PUSH sync path
router.post(["/device-token", "/fcm/save-fcm"], registerDeviceToken);

// 🚨 ADDED ROUTE: Fetch Partner Info for Chat
// Must be placed here at the bottom of protected routes to prevent route collisions.
router.get("/:id", getUserById);

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
