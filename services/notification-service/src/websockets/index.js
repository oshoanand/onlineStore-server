// import { Server } from "socket.io";
// import { createAdapter } from "@socket.io/redis-adapter";
// import jwt from "jsonwebtoken";
// import { logger } from "@shop/utils";
// import crypto from "crypto";
// import prisma from "../config/prisma.js";
// import {
//   pubClient,
//   subClient,
//   redisClient,
// } from "@shop/event-bus/src/redis.js";

// let ioInstance;

// export const initWebSocketServer = (server) => {
//   const io = new Server(server, {
//     cors: { origin: "*", methods: ["GET", "POST"] },
//     // Ensure this matches exactly what the frontend requests
//     // path: "/api/notifications/socket.io",
//     path: "/socket.io",
//     // Best practice for dropping ghost connections
//     pingTimeout: 60000,
//     pingInterval: 25000,
//   });

//   // Attach Redis Adapter for Horizontal Scaling
//   io.adapter(createAdapter(pubClient, subClient));

//   // ==========================================
//   // MIDDLEWARE: Authentication
//   // ==========================================
//   io.use((socket, next) => {
//     const token = socket.handshake.auth?.token || socket.handshake.query?.token;

//     if (!token) {
//       return next(new Error("Unauthorized: No token provided"));
//     }

//     try {
//       const decoded = jwt.verify(token, process.env.JWT_SECRET);
//       socket.user = decoded;
//       next();
//     } catch (err) {
//       logger.error(`[WebSocket] Token verification failed: ${err.message}`);
//       next(new Error("Unauthorized: Invalid token"));
//     }
//   });

//   // ==========================================
//   // CONNECTION HANDLING
//   // ==========================================
//   io.on("connection", async (socket) => {
//     const userId = socket.user.id;
//     logger.info(
//       `[WebSocket] User ${userId} connected. Socket ID: ${socket.id}`,
//     );

//     // 1. JOIN PERSONAL ROOM
//     socket.join(userId);

//     // 2. MARK USER ONLINE
//     try {
//       await prisma.userPresence.upsert({
//         where: { userId },
//         update: { isOnline: true, lastSeen: new Date() },
//         create: { userId, isOnline: true },
//       });
//       io.emit("user_status_change", { userId, isOnline: true });
//     } catch (err) {
//       logger.error(`[WebSocket] Presence update failed: ${err.message}`);
//     }

//     socket.emit("system_alert", {
//       type: "CONNECTED",
//       message: "Real-time notifications & chat active",
//     });

//     // ==========================================
//     // CHAT FUNCTIONALITY
//     // ==========================================
//     socket.on("join_chat_room", (roomId) => {
//       socket.join(roomId);
//       logger.info(`[Chat] User ${userId} joined room ${roomId}`);
//     });

//     socket.on("typing", ({ roomId }) => {
//       socket.to(roomId).emit("user_typing", { userId, isTyping: true });
//     });

//     socket.on("stop_typing", ({ roomId }) => {
//       socket.to(roomId).emit("user_typing", { userId, isTyping: false });
//     });

//     socket.on("send_message", async (data, callback) => {
//       try {
//         const messagePayload = {
//           id: crypto.randomUUID(),
//           roomId: data.roomId,
//           senderId: userId,
//           senderRole: socket.user.role || "USER",
//           content: data.content || null,
//           fileUrl: data.fileUrl || null,
//           fileName: data.fileName || null,
//           fileType: data.fileType || null,
//           isDeleted: false,
//           isRead: false,
//           timestamp: new Date().toISOString(),
//         };

//         // Broadcast to everyone in the chat room (including sender)
//         io.to(data.roomId).emit("receive_message", messagePayload);

//         // Offload DB Save to Redis Streams
//         await redisClient.xadd(
//           "stream:chat_messages",
//           "*",
//           "payload",
//           JSON.stringify(messagePayload),
//         );

//         if (typeof callback === "function") {
//           callback({ status: "sent", id: messagePayload.id });
//         }
//       } catch (err) {
//         logger.error(`[Chat] Send message failed: ${err.message}`);
//       }
//     });

//     socket.on("delete_message", async ({ messageId, roomId }) => {
//       io.to(roomId).emit("message_deleted", { messageId });
//       try {
//         await prisma.chatMessage.update({
//           where: { id: messageId },
//           data: { isDeleted: true },
//         });
//       } catch (err) {
//         logger.error(`[Chat] Delete failed: ${err.message}`);
//       }
//     });

//     socket.on("mark_messages_read", async ({ messageIds, roomId }) => {
//       io.to(roomId).emit("messages_read", { messageIds, readBy: userId });
//       try {
//         await prisma.chatMessage.updateMany({
//           where: { id: { in: messageIds } },
//           data: { isRead: true },
//         });
//       } catch (err) {
//         logger.error(`[Chat] Read receipt update failed: ${err.message}`);
//       }
//     });

//     // ==========================================
//     // DISCONNECT HANDLING
//     // ==========================================
//     socket.on("disconnect", async () => {
//       logger.info(
//         `[WebSocket] User ${userId} disconnected. Socket ID: ${socket.id}`,
//       );
//       try {
//         // Only mark offline if they closed ALL their tabs/devices
//         const activeTabs = await io.in(userId).fetchSockets();
//         if (activeTabs.length === 0) {
//           await prisma.userPresence.update({
//             where: { userId },
//             data: { isOnline: false, lastSeen: new Date() },
//           });
//           io.emit("user_status_change", {
//             userId,
//             isOnline: false,
//             lastSeen: new Date(),
//           });
//         }
//       } catch (err) {
//         logger.error(`[WebSocket] Presence disconnect failed: ${err.message}`);
//       }
//     });
//   });

//   ioInstance = io;
//   return io;
// };

// export const pushToUserWebsocket = (userId, payload) => {
//   if (ioInstance) {
//     ioInstance.to(userId).emit("new_notification", payload);
//   } else {
//     logger.warn("[WebSocket] ioInstance not initialized.");
//   }
// };
import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import jwt from "jsonwebtoken";
import { logger } from "@shop/utils";
import crypto from "crypto";
import prisma from "../config/prisma.js";
import {
  pubClient,
  subClient,
  redisClient,
} from "@shop/event-bus/src/redis.js";

let ioInstance;

export const initWebSocketServer = (server) => {
  const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    // 🚨 CRITICAL FIX: Ensure this matches EXACTLY what the frontend requests
    // and what the Gateway proxies without rewriting
    path: "/api/notifications/socket.io",
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  io.adapter(createAdapter(pubClient, subClient));

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;

    if (!token) {
      return next(new Error("Unauthorized: No token provided"));
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.user = decoded;
      next();
    } catch (err) {
      logger.error(`[WebSocket] Token verification failed: ${err.message}`);
      next(new Error("Unauthorized: Invalid token"));
    }
  });

  io.on("connection", async (socket) => {
    const userId = socket.user.id;
    logger.info(
      `[WebSocket] User ${userId} connected. Socket ID: ${socket.id}`,
    );

    socket.join(userId);

    try {
      await prisma.userPresence.upsert({
        where: { userId },
        update: { isOnline: true, lastSeen: new Date() },
        create: { userId, isOnline: true },
      });
      io.emit("user_status_change", { userId, isOnline: true });
    } catch (err) {
      logger.error(`[WebSocket] Presence update failed: ${err.message}`);
    }

    socket.emit("system_alert", {
      type: "CONNECTED",
      message: "Real-time notifications & chat active",
    });

    // ==========================================
    // CHAT FUNCTIONALITY
    // ==========================================
    socket.on("join_chat_room", (roomId) => {
      socket.join(roomId);
      logger.info(`[Chat] User ${userId} joined room ${roomId}`);
    });

    socket.on("typing", ({ roomId }) => {
      socket.to(roomId).emit("user_typing", { userId, isTyping: true });
    });

    socket.on("stop_typing", ({ roomId }) => {
      socket.to(roomId).emit("user_typing", { userId, isTyping: false });
    });

    socket.on("send_message", async (data, callback) => {
      try {
        const messagePayload = {
          id: crypto.randomUUID(),
          roomId: data.roomId,
          senderId: userId,
          senderRole: socket.user.role || "USER",
          content: data.content || null,
          fileUrl: data.fileUrl || null,
          fileName: data.fileName || null,
          fileType: data.fileType || null,
          isDeleted: false,
          isRead: false,
          timestamp: new Date().toISOString(),
        };

        // Broadcast to everyone in the chat room (including sender)
        io.to(data.roomId).emit("receive_message", messagePayload);

        // Offload DB Save to Redis Streams
        await redisClient.xadd(
          "stream:chat_messages",
          "*",
          "payload",
          JSON.stringify(messagePayload),
        );

        if (typeof callback === "function") {
          callback({ status: "sent", id: messagePayload.id });
        }
      } catch (err) {
        logger.error(`[Chat] Send message failed: ${err.message}`);
      }
    });

    socket.on("delete_message", async ({ messageId, roomId }) => {
      io.to(roomId).emit("message_deleted", { messageId });
      try {
        await prisma.chatMessage.update({
          where: { id: messageId },
          data: { isDeleted: true },
        });
      } catch (err) {
        logger.error(`[Chat] Delete failed: ${err.message}`);
      }
    });

    socket.on("mark_messages_read", async ({ messageIds, roomId }) => {
      io.to(roomId).emit("messages_read", { messageIds, readBy: userId });
      try {
        await prisma.chatMessage.updateMany({
          where: { id: { in: messageIds } },
          data: { isRead: true },
        });
      } catch (err) {
        logger.error(`[Chat] Read receipt update failed: ${err.message}`);
      }
    });

    socket.on("disconnect", async () => {
      logger.info(
        `[WebSocket] User ${userId} disconnected. Socket ID: ${socket.id}`,
      );
      try {
        const activeTabs = await io.in(userId).fetchSockets();
        if (activeTabs.length === 0) {
          await prisma.userPresence.update({
            where: { userId },
            data: { isOnline: false, lastSeen: new Date() },
          });
          io.emit("user_status_change", {
            userId,
            isOnline: false,
            lastSeen: new Date(),
          });
        }
      } catch (err) {
        logger.error(`[WebSocket] Presence disconnect failed: ${err.message}`);
      }
    });
  });

  ioInstance = io;
  return io;
};

// 🚨 Payload is generated in consumer.js and passed down securely
export const pushToUserWebsocket = (userId, payload) => {
  if (ioInstance) {
    ioInstance.to(userId).emit("new_notification", payload);
  } else {
    logger.warn("[WebSocket] ioInstance not initialized.");
  }
};
