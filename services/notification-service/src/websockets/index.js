import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import jwt from "jsonwebtoken";
import { logger } from "@shop/utils";
import prisma from "../config/prisma.js";
import {
  pubClient,
  subClient,
  redisClient,
} from "@shop/event-bus/src/redis.js";

let ioInstance;

export const initWebSocketServer = (server) => {
  const io = new Server(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      credentials: true,
    },
    path: "/api/notifications/socket.io",
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  io.adapter(createAdapter(pubClient, subClient));

  // ==========================================
  // MIDDLEWARE: SECURE JWT AUTHENTICATION
  // ==========================================
  io.use((socket, next) => {
    // 🚨 Extract the JWT token sent by the frontend
    const token = socket.handshake.auth?.token;

    if (!token) {
      return next(new Error("Authentication error: Token required"));
    }

    try {
      // 🚨 Cryptographically verify the token using your NextAuth secret
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // Attach the trusted user ID to the socket
      socket.userId = decoded.id.toString();
      socket.userRole = decoded.role;

      console.log(
        `✅ Socket authenticated: User ${socket.userId} (Role: ${socket.userRole})`,
      );

      next();
    } catch (error) {
      logger.error(`Socket auth failed: ${error.message}`);
      return next(new Error("Authentication error: Invalid or expired token"));
    }
  });

  // ==========================================
  // CONNECTION HANDLER
  // ==========================================
  io.on("connection", async (socket) => {
    const userId = socket.userId;
    logger.info(`🔌 Client Connected: ${userId} (Socket: ${socket.id})`);

    // 1. Join a personal room for targeted cross-device sync
    const personalRoom = `user_${userId}`;
    socket.join(personalRoom);

    // 🟢 PRESENCE: USER ONLINE
    try {
      // Add user to global Redis set
      await redisClient.sadd("online_users", userId);
      // Clear any previous last_seen timestamp
      await redisClient.del(`last_seen:${userId}`);

      // Broadcast to all clients that this user is online
      io.emit("user_status_changed", {
        userId: userId,
        isOnline: true,
        lastSeen: null,
      });

      // Send the connecting user the current list of online users
      const onlineUsers = await redisClient.smembers("online_users");
      socket.emit("online_users_list", onlineUsers);
    } catch (error) {
      console.error("❌ Redis Error during presence update:", error);
    }

    // ==========================================
    // 💬 CHAT: SEND MESSAGE
    // ==========================================
    socket.on("send_message", async (data) => {
      // Safely parse data (clients sometimes send strings instead of JSON objects)
      let parsedData = data;
      if (typeof data === "string") {
        try {
          parsedData = JSON.parse(data);
        } catch (e) {
          console.error("❌ Failed to parse message data:", e);
          return;
        }
      }

      const { receiverId, text, tempId, imageUrl, replyToId } = parsedData;
      const senderId = userId; // Force sender ID to be the authenticated socket user

      if (!receiverId || (!text && !imageUrl)) {
        console.warn(
          "⚠️ Warning: Missing required fields (receiverId or content)",
        );
        socket.emit("error", { message: "Invalid message payload." });
        return;
      }

      try {
        // Sort IDs to ensure consistent ChatSession lookup (e.g., 'userA_userB')
        const [user1Id, user2Id] = [senderId, receiverId].sort();

        // 1. Manage the Chat Session
        const session = await prisma.chatSession.upsert({
          where: { user1Id_user2Id: { user1Id, user2Id } },
          update: { status: "OPEN", updatedAt: new Date() },
          create: { user1Id, user2Id, status: "OPEN" },
        });

        // 2. Save Message to Database
        const savedMessage = await prisma.chatMessage.create({
          data: {
            chatSessionId: session.id,
            senderId: senderId,
            text: text || null,
            imageUrl: imageUrl || null,
            replyToId: replyToId || null,
            isRead: false,
          },
          include: {
            // Include original message details if it's a reply
            replyTo: replyToId
              ? {
                  select: {
                    id: true,
                    text: true,
                    senderId: true,
                    imageUrl: true,
                  },
                }
              : false,
          },
        });

        console.log(
          `✅ Message saved: Session ${session.id} | Msg ${savedMessage.id}`,
        );

        // 3. ACKNOWLEDGEMENT (Optimistic UI sync for the sender)
        socket.emit("message_confirmed", {
          tempId: tempId,
          message: savedMessage,
        });

        // 4. BROADCAST
        // Send to receiver AND sender (so sender's other open tabs update too)
        const broadcastPayload = { ...savedMessage, tempId: tempId || null };
        io.to(`user_${receiverId}`)
          .to(`user_${senderId}`)
          .emit("receive_message", broadcastPayload);
      } catch (error) {
        console.error("❌ PRISMA DATABASE ERROR (send_message):", error);
        socket.emit("error", {
          message: "Failed to process message on server.",
        });
      }
    });

    // ==========================================
    // 🗑️ CHAT: DELETE MESSAGE
    // ==========================================
    socket.on("delete_message", async (data) => {
      const parsedData = typeof data === "string" ? JSON.parse(data) : data;
      const { messageId, partnerId } = parsedData;

      if (!messageId) return;

      try {
        // Find message first to verify ownership
        const msg = await prisma.chatMessage.findUnique({
          where: { id: messageId },
          select: { senderId: true },
        });

        if (!msg) return;

        // Security check: Only the sender can delete their message
        if (msg.senderId !== userId) {
          socket.emit("error", {
            message: "Unauthorized to delete this message.",
          });
          return;
        }

        await prisma.chatMessage.delete({
          where: { id: messageId },
        });

        console.log(`🗑️ Message ${messageId} deleted by ${userId}`);

        // Notify both parties to remove it from their UI
        if (partnerId) {
          io.to(`user_${partnerId}`)
            .to(`user_${userId}`)
            .emit("message_deleted", { messageId });
        }
      } catch (error) {
        console.error("❌ Error deleting message:", error);
      }
    });

    // ==========================================
    // ✍️ CHAT: TYPING INDICATORS
    // ==========================================
    socket.on("typing", (data) => {
      const receiverId = typeof data === "object" ? data.receiverId : data;
      if (receiverId) {
        io.to(`user_${receiverId}`).emit("user_typing", { senderId: userId });
      }
    });

    socket.on("stop_typing", (data) => {
      const receiverId = typeof data === "object" ? data.receiverId : data;
      if (receiverId) {
        io.to(`user_${receiverId}`).emit("user_stopped_typing", {
          senderId: userId,
        });
      }
    });

    // ==========================================
    // ✔️✔ CHAT: READ RECEIPTS
    // ==========================================
    socket.on("mark_messages_read", async (data) => {
      const parsedData = typeof data === "string" ? JSON.parse(data) : data;

      // senderId refers to the person who originally sent the messages
      // (the current user is reading them)
      const senderId = parsedData.senderId;

      if (!senderId) return;

      try {
        const [user1Id, user2Id] = [userId, senderId].sort();
        const now = new Date();

        const session = await prisma.chatSession.findUnique({
          where: { user1Id_user2Id: { user1Id, user2Id } },
        });

        if (session) {
          // Update all unread messages in this session sent by the partner
          const updateResult = await prisma.chatMessage.updateMany({
            where: {
              chatSessionId: session.id,
              senderId: senderId,
              isRead: false,
            },
            data: {
              isRead: true,
              readAt: now,
            },
          });

          // If we actually updated messages, notify the original sender
          if (updateResult.count > 0) {
            io.to(`user_${senderId}`).emit("messages_read_by_recipient", {
              readerId: userId,
              readAt: now.toISOString(),
            });

            // Sync the reader's other devices so they clear unread badges immediately
            socket.emit("read_status_synced", { partnerId: senderId });
          }
        }
      } catch (error) {
        console.error("❌ Error marking read:", error);
      }
    });

    // ==========================================
    // 🔴 PRESENCE: USER OFFLINE (DISCONNECT)
    // ==========================================
    socket.on("disconnect", async () => {
      const lastSeenTime = new Date().toISOString();

      try {
        // 1. Remove from online set
        await redisClient.srem("online_users", userId);

        // 2. Set last seen time in Redis (Expires after 7 days to save memory)
        await redisClient.set(
          `last_seen:${userId}`,
          lastSeenTime,
          "EX",
          60 * 60 * 24 * 7,
        );

        // 3. Broadcast offline status
        io.emit("user_status_changed", {
          userId: userId,
          isOnline: false,
          lastSeen: lastSeenTime,
        });

        console.log(`🔌 User Offline: ${userId} (Last seen: ${lastSeenTime})`);
      } catch (error) {
        console.error("❌ Redis Error on disconnect:", error);
      }
    });
  });

  ioInstance = io;
  return io;
};

// Externally accessible push function for HTTP REST triggers
export const pushToUserWebsocket = (userId, payload) => {
  if (ioInstance) {
    // 🚨 FIX: Emit to the correctly formatted room name
    ioInstance.to(`user_${userId}`).emit("new_notification", payload);
  } else {
    logger.warn("[WebSocket] ioInstance not initialized.");
  }
};
