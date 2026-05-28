import prisma from "../config/prisma.js";
import { optimizeAndUpload } from "@shop/utils"; // Assuming you have this helper in your utils package

// ==========================================
// 1. STANDARD NOTIFICATIONS
// ==========================================

export const getMyNotifications = async (req, res, next) => {
  try {
    const notifications = await prisma.notification.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: "desc" },
      take: 50, // Limit to recent 50
    });

    // Count unread
    const unreadCount = notifications.filter((n) => !n.isRead).length;

    res.status(200).json({
      success: true,
      data: { unreadCount, notifications },
    });
  } catch (error) {
    next(error);
  }
};

export const markAsRead = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Use updateMany so it doesn't throw if the record doesn't belong to the user
    await prisma.notification.updateMany({
      where: { id, userId: req.user.id },
      data: { isRead: true },
    });

    res.status(200).json({ success: true, message: "Marked as read" });
  } catch (error) {
    next(error);
  }
};

export const markAllAsRead = async (req, res, next) => {
  try {
    // Update all unread notifications for this specific user
    await prisma.notification.updateMany({
      where: {
        userId: req.user.id,
        isRead: false,
      },
      data: { isRead: true },
    });

    res
      .status(200)
      .json({ success: true, message: "All notifications marked as read" });
  } catch (error) {
    next(error);
  }
};
// ==========================================
// 2. CHAT FUNCTIONALITY
// ==========================================

export const getChatHistory = async (req, res, next) => {
  try {
    const { roomId } = req.params;

    // Optional: Add authorization check here to ensure the user is allowed to view this room

    const messages = await prisma.chatMessage.findMany({
      where: { roomId },
      orderBy: { createdAt: "asc" }, // Oldest first, like WhatsApp
      take: 100, // Limit history for performance, implement cursor pagination later if needed
    });

    res.status(200).json({ success: true, data: messages });
  } catch (error) {
    next(error);
  }
};

export const uploadChatAttachment = async (req, res, next) => {
  try {
    if (!req.file) throw new Error("No file uploaded");

    const roomId = req.body.roomId;
    if (!roomId) throw new Error("Room ID is required");

    let fileUrl;

    // 1. If it's an image, optimize it using Sharp (e.g., resize to max 1200px width)
    if (req.file.mimetype.startsWith("image/")) {
      fileUrl = await optimizeAndUpload(
        req.file,
        `chat/${roomId}/images`,
        req.user.id, // Use userId as the filename prefix/slug
        1200,
      );
    }
    // 2. If it's a document (PDF, Docx), upload raw without resizing
    else {
      fileUrl = await optimizeAndUpload(
        req.file,
        `chat/${roomId}/docs`,
        req.user.id,
        null, // No resize width
        true, // true flag bypasses the Sharp image optimizer in your utility
      );
    }

    res.status(200).json({
      success: true,
      data: {
        fileUrl,
        fileName: req.file.originalname,
        fileType: req.file.mimetype,
        fileSize: req.file.size,
      },
    });
  } catch (error) {
    next(error);
  }
};
