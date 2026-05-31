import prisma from "../config/prisma.js";
import { optimizeAndUpload } from "@shop/utils";
import { redisClient } from "@shop/event-bus/src/redis.js";
import axios from "axios";

// ==========================================
// HELPERS: ENUM MAPPERS
// ==========================================
const mapSupportType = (type) => {
  switch (type?.toUpperCase()) {
    case "BUG":
      return "BUG_REPORT";
    case "FEATURE":
      return "FEATURE_REQUEST";
    default:
      return "OTHER";
  }
};

const mapTicketStatus = (status) => {
  switch (status?.toUpperCase()) {
    case "PENDING":
      return "OPEN";
    case "IN_PROGRESS":
      return "IN_PROGRESS";
    case "RESOLVED":
      return "RESOLVED";
    case "REJECTED":
      return "CLOSED";
    case "CLOSED":
      return "CLOSED";
    default:
      return "OPEN";
  }
};

// ==========================================
// 1. STANDARD NOTIFICATIONS
// ==========================================

export const getMyNotifications = async (req, res, next) => {
  try {
    const notifications = await prisma.notification.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

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
    await prisma.notification.updateMany({
      where: { userId: req.user.id, isRead: false },
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

// 🚨 NEW: Gets the global unread chat badge count for Zustand
export const getUnreadChatCount = async (req, res, next) => {
  const userId = req.user.id;

  try {
    const unreadCount = await prisma.chatMessage.count({
      where: {
        session: {
          OR: [{ user1Id: userId }, { user2Id: userId }],
        },
        senderId: { not: userId },
        isRead: false,
      },
    });

    res.status(200).json({ totalUnread: unreadCount });
  } catch (error) {
    console.error("Error fetching unread count:", error);
    next(error);
  }
};

export const getChatSessions = async (req, res, next) => {
  const userId = req.user?.id || req.query.userId;
  if (!userId) return res.status(400).json({ message: "userId required" });

  try {
    const userServiceUrl =
      process.env.USER_SERVICE_URL || "http://localhost:4002";

    // 1. FETCH SESSIONS FROM NOTIFICATION DB
    // We cannot 'include' users here because they live in a different microservice
    const sessions = await prisma.chatSession.findMany({
      where: { OR: [{ user1Id: userId }, { user2Id: userId }] },
      include: {
        messages: { orderBy: { createdAt: "desc" }, take: 1 },
        _count: {
          select: {
            messages: { where: { isRead: false, senderId: { not: userId } } },
          },
        },
      },
      orderBy: { updatedAt: "desc" },
    });

    // 2. EXTRACT PARTNER IDS
    const partnerIds = sessions.map((s) =>
      s.user1Id === userId ? s.user2Id : s.user1Id,
    );

    // 3. FETCH PRESENCE FROM REDIS
    const onlineUsersArray = (await redisClient.smembers("online_users")) || [];
    const onlineUsers = new Set(onlineUsersArray);

    const lastSeenKeys = partnerIds.map((id) => `last_seen:${id}`);
    const lastSeenValues =
      lastSeenKeys.length > 0 ? await redisClient.mget(lastSeenKeys) : [];

    const lastSeenMap = {};
    partnerIds.forEach((id, index) => {
      lastSeenMap[id] = lastSeenValues[index];
    });

    // 4. FETCH USER PROFILES FROM USER-SERVICE
    const userProfiles = {};
    let adminProfile = null;

    // Use Promise.all to fetch partner names/images concurrently
    await Promise.all(
      partnerIds.map(async (pId) => {
        try {
          const { data } = await axios.get(
            `${userServiceUrl}/internal/${pId}`,
            {
              headers: { "x-internal-secret": process.env.INTERNAL_API_SECRET },
            },
          );

          const pData = data?.data || data;
          const role = (pData?.role || "CUSTOMER").toUpperCase();

          userProfiles[pId] = {
            id: pId,
            name:
              pData?.customerProfile?.fullName ||
              pData?.administratorProfile?.fullName ||
              pData?.name ||
              "Пользователь",
            image:
              pData?.customerProfile?.profilePhoto ||
              pData?.administratorProfile?.profilePhoto ||
              pData?.image ||
              null,
            role: role,
          };

          if (role === "ADMINISTRATOR") {
            adminProfile = userProfiles[pId];
          }
        } catch (e) {
          // Fallback if the user service fails for a specific user
          userProfiles[pId] = {
            id: pId,
            name: "Пользователь",
            image: null,
            role: "CUSTOMER",
          };
        }
      }),
    );

    // 5. ASSEMBLE DTO FOR FRONTEND
    let formattedSessions = sessions.map((session) => {
      const partnerId =
        session.user1Id === userId ? session.user2Id : session.user1Id;
      const partner = userProfiles[partnerId] || {
        name: "Пользователь",
        image: null,
        role: "CUSTOMER",
      };
      const lastMessage = session.messages[0];
      const isOnline = onlineUsers.has(partnerId);
      // const lastSeen = isOnline
      //   ? null
      //   : lastSeenMap[partnerId] || session.updatedAt;

      // ✅ FIX: Fall back to the partner's actual user profile updatedAt/lastActiveAt from the User Service
      // If none exists, leave it as null. NEVER use session.updatedAt!
      const lastSeen = isOnline
        ? null
        : lastSeenMap[partnerId] ||
          partner.lastActiveAt ||
          partner.updatedAt ||
          null;

      return {
        id: session.id,
        partnerId: partnerId,
        partnerName: partner.name,
        partnerRole: partner.role,
        partnerImage: partner.image,
        lastMessage: lastMessage
          ? lastMessage.text ||
            (lastMessage.imageUrl ? "Вложение 📎" : "📷 Фотография")
          : "Нет сообщений",
        lastMessageTime: lastMessage
          ? lastMessage.createdAt.toISOString()
          : session.updatedAt.toISOString(),
        unreadCount: session._count.messages,
        isOnline: isOnline,
        lastSeen: lastSeen,
        isAdmin: partner.role === "ADMINISTRATOR",
      };
    });

    // 6. ROBUST ADMIN INJECTION
    // Always pin an admin to the top for standard users, even if they have no chat history yet.
    const userRole = (req.user?.role || "CUSTOMER").toUpperCase();

    if (userRole !== "ADMINISTRATOR") {
      if (adminProfile) {
        // Admin already in history -> Move to top
        const adminIndex = formattedSessions.findIndex(
          (s) => s.partnerId === adminProfile.id,
        );
        if (adminIndex !== -1) {
          formattedSessions[adminIndex].isAdmin = true;
          const [adminSession] = formattedSessions.splice(adminIndex, 1);
          formattedSessions.unshift(adminSession);
        }
      } else {
        // Admin NOT in history -> We need to generate a default support profile at the top
        // (In a real app, you might do an Axios call to get the specific system admin's ID here)
        const fallbackAdminId = "system_admin"; // Replace with real admin ID fetch if needed

        formattedSessions.unshift({
          id: `admin-session-default`,
          partnerId: fallbackAdminId,
          partnerName: "Служба поддержки",
          partnerRole: "ADMINISTRATOR",
          partnerImage: null, // Add a generic support avatar URL here if desired
          lastMessage: "Служба заботы о партнерах",
          lastMessageTime: new Date().toISOString(),
          unreadCount: 0,
          isOnline: onlineUsers.has(fallbackAdminId),
          lastSeen: null,
          isAdmin: true,
        });
      }
    }

    res.status(200).json(formattedSessions);
  } catch (error) {
    console.error("❌ Error fetching chat sessions:", error);
    next(error);
  }
};

export const getChatHistory = async (req, res, next) => {
  const userId1 = req.user?.id;
  const { userId2, cursor, limit = "20" } = req.query;
  const takeLimit = parseInt(limit);

  if (!userId1 || !userId2) {
    return res.status(400).json({ message: "userId1 and userId2 required" });
  }

  try {
    const [user1Id, user2Id] = [userId1, userId2].sort();

    const session = await prisma.chatSession.findUnique({
      where: { user1Id_user2Id: { user1Id, user2Id } },
    });

    if (!session) return res.status(200).json([]);

    const messages = await prisma.chatMessage.findMany({
      where: { chatSessionId: session.id },
      take: takeLimit,
      skip: cursor && cursor !== "" ? 1 : 0,
      cursor: cursor && cursor !== "" ? { id: cursor } : undefined,
      orderBy: { createdAt: "desc" }, // Fetch newest first for pagination
      include: {
        replyTo: {
          select: { id: true, text: true, imageUrl: true, senderId: true },
        },
      },
    });

    // IMPORTANT: React Query/Frontend expects chronological order
    // Reverse the array so the oldest message in the batch is at index 0
    res.status(200).json(messages.reverse());
  } catch (error) {
    console.error("Error fetching chat history:", error);
    next(error);
  }
};

export const uploadChatAttachment = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No valid image uploaded." });
    }

    // 1. Utilize the unified optimizeAndUpload pipeline
    // 1200px is great for chat images (maintains detail while compressing heavily via WebP)
    const fullUrl = await optimizeAndUpload(
      req.file,
      "chats", // baseFolder
      req.user.id, // dynamicId
      1200, // width
    );

    console.log(fullUrl);
    if (!fullUrl) {
      throw new Error("Image processing returned null");
    }
    const MINIO_BUCKET_NAME = process.env.MINIO_BUCKET_NAME || "shop-uploads";
    // 2. Extract the file key from the URL just in case the frontend needs it for deletion
    const fileName = fullUrl.split(`${MINIO_BUCKET_NAME}/`)[1];

    res.status(200).json({
      success: true,
      url: fullUrl,
      fileName: fileName,
    });
  } catch (error) {
    console.error("Upload route error:", error);
    next(error);
  }
};

export const initChatSession = async (req, res, next) => {
  try {
    const currentUserId = req.user.id;
    const { partnerId } = req.body;

    if (!partnerId)
      return res.status(400).json({ message: "partnerId required" });
    if (currentUserId === partnerId)
      return res.status(400).json({ message: "Cannot chat with yourself" });

    const [user1Id, user2Id] = [currentUserId, partnerId].sort();

    const session = await prisma.chatSession.upsert({
      where: { user1Id_user2Id: { user1Id, user2Id } },
      update: {},
      create: { user1Id, user2Id, status: "OPEN" },
    });

    res.status(200).json({ chatId: session.id, partnerId });
  } catch (error) {
    console.error("Init chat error:", error);
    next(error);
  }
};

// ==========================================
// 3. SUPPORT TICKETS
// ==========================================

export const createSupportTicket = async (req, res, next) => {
  try {
    const { mobile, support_type, description, subject } = req.body;
    const userId = req.user?.id || null;
    let attachments = [];

    if (req.file) {
      const fileUrl = await optimizeAndUpload(
        req.file,
        `support/tickets/images/${userId || "guest"}`,
        "ticket",
        1200,
      );
      if (fileUrl) attachments.push(fileUrl);
    }

    const newTicket = await prisma.supportTicket.create({
      data: {
        subject: subject || "Новое обращение",
        description: description || "",
        type: mapSupportType(support_type),
        priority: "NORMAL",
        status: "OPEN",
        contactMobile: mobile,
        requesterId: userId,
        attachments,
      },
    });

    res.status(201).json({
      success: true,
      message: "Ticket created successfully",
      data: newTicket,
    });
  } catch (error) {
    next(error);
  }
};
