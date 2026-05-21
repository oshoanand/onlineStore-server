import { redisClient } from "@shop/event-bus";
import { logger } from "@shop/utils";
import prisma from "../config/prisma.js";

const STREAM_NAME = "stream:chat_messages";
const GROUP_NAME = "chat_persistence_group";

// Create a unique consumer name per instance/process to avoid conflicts if you scale
const CONSUMER_NAME = `consumer_${process.pid}_${Math.random().toString(36).substring(2, 9)}`;

export const startChatWorker = async () => {
  try {
    // 1. Create the Consumer Group
    // "$" means read from the tail (only new messages).
    // "MKSTREAM" creates the stream automatically if it doesn't exist yet.
    await redisClient.xgroup(
      "CREATE",
      STREAM_NAME,
      GROUP_NAME,
      "$",
      "MKSTREAM",
    );
    logger.info(`✅ Redis Stream Group '${GROUP_NAME}' created.`);
  } catch (error) {
    // 2. Handle existing group safely
    // BUSYGROUP simply means the group was already created on a previous startup. This is normal.
    if (error.message && error.message.includes("BUSYGROUP")) {
      logger.info(
        `⚡ Redis Stream Group '${GROUP_NAME}' already exists. Joining as ${CONSUMER_NAME}...`,
      );
    } else {
      logger.error("❌ Stream group creation error:", error);
      return; // Exit if it's a critical Redis failure
    }
  }

  logger.info("🚀 Started Redis Stream Worker for Chat Persistence");

  // 3. Start the polling loop
  pollStream();
};

const pollStream = async () => {
  try {
    // 4. Read from the Stream
    // Blocks for 5000ms (5 seconds) waiting for new messages to avoid CPU-heavy spinning
    // ">" means read messages that have NEVER been delivered to other consumers in this group
    const results = await redisClient.xreadgroup(
      "GROUP",
      GROUP_NAME,
      CONSUMER_NAME,
      "COUNT",
      10, // Process up to 10 messages at a time
      "BLOCK",
      5000,
      "STREAMS",
      STREAM_NAME,
      ">",
    );

    // 5. Process Results
    if (results && results.length > 0) {
      const streamData = results[0]; // [STREAM_NAME, messagesArray]
      const messages = streamData[1]; // Array of actual messages

      for (const msg of messages) {
        const redisId = msg[0]; // e.g., "1690000000000-0"
        const fields = msg[1]; // e.g., ["payload", '{"roomId":"123", ...}']

        // Safely extract the payload string
        const payloadIndex = fields.indexOf("payload");
        if (payloadIndex === -1) {
          logger.warn(
            `⚠️ Missing 'payload' in stream message ${redisId}. Skipping.`,
          );
          // Acknowledge invalid messages so they don't clog the queue
          await redisClient.xack(STREAM_NAME, GROUP_NAME, redisId);
          continue;
        }

        const rawPayload = fields[payloadIndex + 1];

        try {
          // Parse the JSON payload sent by the Socket.IO event
          const data = JSON.parse(rawPayload);

          // 6. Save to Database
          await prisma.chatMessage.create({
            data: {
              id: data.id,
              roomId: data.roomId,
              senderId: data.senderId,
              senderRole: data.senderRole,
              content: data.content,
              fileUrl: data.fileUrl,
              fileName: data.fileName,
              fileType: data.fileType,
              isRead: false,
              isDeleted: false,
              createdAt: data.timestamp ? new Date(data.timestamp) : new Date(),
            },
          });

          // 7. Acknowledge (XACK) the message
          // This removes it from the Pending Entries List (PEL)
          await redisClient.xack(STREAM_NAME, GROUP_NAME, redisId);
          logger.info(`💾 Persisted chat message: ${data.id}`);
        } catch (parseOrDbError) {
          logger.error(
            `❌ Failed to parse or save message ${redisId}:`,
            parseOrDbError,
          );
          // NOTE: We acknowledge (XACK) even on failure to prevent a "Poison Pill" loop
          // where a badly formatted message crashes the worker infinitely.
          // In a high-compliance system, you would send this to a Dead Letter Queue (DLQ) instead.
          await redisClient.xack(STREAM_NAME, GROUP_NAME, redisId);
        }
      }
    }
  } catch (error) {
    // Suppress expected timeout/reconnect errors to keep logs clean
    if (error.message && !error.message.includes("Connection is closed")) {
      logger.error("❌ Chat worker polling error:", error);
    }
  } finally {
    // 8. Recursive Polling
    // Use setTimeout rather than direct function calls to prevent 'Maximum call stack size exceeded' errors
    setTimeout(pollStream, 100);
  }
};
