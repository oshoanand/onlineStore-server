import { redisClient } from "@shop/event-bus";
import { logger } from "@shop/utils";
import prisma from "../config/prisma.js";

const STREAM_NAME = "stream:chat_messages";
const GROUP_NAME = "chat_persistence_group";
const CONSUMER_NAME = `consumer_${process.pid}_${Math.random().toString(36).substring(2, 9)}`;

export const startChatWorker = async () => {
  try {
    await redisClient.xgroup(
      "CREATE",
      STREAM_NAME,
      GROUP_NAME,
      "$",
      "MKSTREAM",
    );
    logger.info(`✅ Redis Stream Group '${GROUP_NAME}' created.`);
  } catch (error) {
    if (error.message && !error.message.includes("BUSYGROUP")) {
      logger.error("❌ Stream group creation error:", error);
      return;
    }
  }

  logger.info("🚀 Started Redis Stream Worker for Chat Persistence");
  pollStream();
};

const pollStream = async () => {
  try {
    const results = await redisClient.xreadgroup(
      "GROUP",
      GROUP_NAME,
      CONSUMER_NAME,
      "COUNT",
      10,
      "BLOCK",
      5000,
      "STREAMS",
      STREAM_NAME,
      ">",
    );

    if (results && results.length > 0) {
      const messages = results[0][1];

      for (const msg of messages) {
        const redisId = msg[0];
        const fields = msg[1];
        const payloadIndex = fields.indexOf("payload");

        if (payloadIndex === -1) {
          await redisClient.xack(STREAM_NAME, GROUP_NAME, redisId);
          continue;
        }

        const rawPayload = fields[payloadIndex + 1];

        try {
          const data = JSON.parse(rawPayload);

          const ids = data.roomId.split("_");
          const [user1Id, user2Id] = ids.sort();

          // 1. Upsert Session: Update lastMessage and force status to OPEN
          // (Crucial if an admin previously marked the session as CLOSED/RESOLVED)
          const session = await prisma.chatSession.upsert({
            where: { user1Id_user2Id: { user1Id, user2Id } },
            update: {
              lastMessage: data.content || (data.fileUrl ? "Вложение 📎" : ""),
              lastActive: new Date(),
              status: "OPEN",
            },
            create: {
              user1Id,
              user2Id,
              lastMessage: data.content || (data.fileUrl ? "Вложение 📎" : ""),
              lastActive: new Date(),
              status: "OPEN",
            },
          });

          // 2. Save Message to Database
          await prisma.chatMessage.create({
            data: {
              id: data.id,
              chatSessionId: session.id,
              senderId: data.senderId,
              senderRole: data.senderRole,
              content: data.content,
              fileUrl: data.fileUrl,
              fileName: data.fileName,
              fileType: data.fileType,
              isRead: false,
              isDeleted: false,
              // Map the replyToId if the user replied to a specific message
              ...(data.replyToId && { replyToId: data.replyToId }),
              createdAt: data.timestamp ? new Date(data.timestamp) : new Date(),
            },
          });

          // 3. Acknowledge message to remove it from Redis Pending Entries List
          await redisClient.xack(STREAM_NAME, GROUP_NAME, redisId);
          logger.info(
            `💾 Persisted message ${data.id} to session ${session.id}`,
          );
        } catch (dbError) {
          logger.error(
            `❌ DB Persistence failed for message ${redisId}:`,
            dbError,
          );
          // Acknowledge even on DB failure to prevent a poison-pill loop from crashing the worker
          await redisClient.xack(STREAM_NAME, GROUP_NAME, redisId);
        }
      }
    }
  } catch (error) {
    if (error.message && !error.message.includes("Connection is closed")) {
      logger.error("❌ Chat worker polling error:", error);
    }
  } finally {
    // 4. Recursive Polling loop
    setTimeout(pollStream, 100);
  }
};
