import express from "express";
import { UnauthorizedError, createUploader } from "@shop/utils";
import {
  getMyNotifications,
  markAsRead,
  getChatHistory,
  uploadChatAttachment,
} from "../controllers/notification.js";

// ==========================================
// MIDDLEWARE: Authentication via API Gateway
// ==========================================
const requireAuth = (req, res, next) => {
  const userId = req.headers["x-user-id"];

  if (!userId) {
    return next(new UnauthorizedError("Unauthorized: Missing User Context"));
  }

  req.user = {
    id: userId,
    role: req.headers["x-user-role"],
  };

  next();
};

const router = express.Router();

// Apply auth to everything below
router.use(requireAuth);

// ==========================================
// 1. STANDARD NOTIFICATIONS
// ==========================================
router.get("/", getMyNotifications);
router.patch("/:id/read", markAsRead);

// ==========================================
// 2. CHAT ROUTES
// ==========================================
// Fetch previous messages when opening a chat window
router.get("/chat/:roomId/history", getChatHistory);

// Handle heavy file uploads via REST (Max 10MB limit)
const upload = createUploader(10);
router.post("/chat/upload", upload.single("attachment"), uploadChatAttachment);

export default router;
