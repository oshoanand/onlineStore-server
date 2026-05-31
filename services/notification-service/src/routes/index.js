import express from "express";
import { UnauthorizedError, createUploader } from "@shop/utils";
import {
  getMyNotifications,
  markAsRead,
  markAllAsRead,
  getChatHistory,
  uploadChatAttachment,
  createSupportTicket,
  getChatSessions,
  getUnreadChatCount,
  initChatSession,
} from "../controllers/notification.js";

// ==========================================
// MIDDLEWARE: Authentication via API Gateway
// ==========================================
const requireAuth = (req, res, next) => {
  // 🚨 CRITICAL FIX: Bypass Express REST Auth for Socket.IO HTTP polling requests.
  // Socket.IO authenticates itself via io.use() in websockets/index.js using the query token.
  // If we don't bypass this, Express blocks the initial connection handshake.
  if (req.originalUrl && req.originalUrl.includes("/socket.io")) {
    return next();
  }

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

router.post("/chat/init", initChatSession);
router.put("/read-all", markAllAsRead);
router.put("/:id/read", markAsRead);

// ==========================================
// 2. CHAT ROUTES
// ==========================================
// Fetch previous messages when opening a chat window
router.get("/chat/sessions", getChatSessions);

router.get("/chat/unread-count", getUnreadChatCount);

router.get("/chat/history", getChatHistory);

// Handle heavy file uploads via REST (Max 10MB limit)
const upload = createUploader(10);
router.post("/chat/upload", upload.single("attachment"), uploadChatAttachment);

router.post(
  "/support/create",
  upload.single("attachment"),
  createSupportTicket,
);

export default router;
