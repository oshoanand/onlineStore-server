import { redisClient } from "./redis.js";

/**
 * Listens to a Redis Stream continuously.
 * @param {string} streamName - e.g., 'stream:orders'
 * @param {string} groupName - e.g., 'email-service-group'
 * @param {Function} messageHandler - Callback function(payload, messageId)
 */
export const consumeEvents = async (streamName, groupName, messageHandler) => {
  const consumerName = `consumer-${process.pid}`;

  // 1. Create Consumer Group (if it doesn't exist)
  try {
    await redisClient.xgroup("CREATE", streamName, groupName, "0", "MKSTREAM");
    console.log(
      `[Consumer Group] Created group ${groupName} for ${streamName}`,
    );
  } catch (error) {
    // BUSYGROUP means the group already exists, which is perfectly fine.
    if (!error.message.includes("BUSYGROUP")) {
      console.error("[Consumer Group Error]:", error);
      throw error;
    }
  }

  console.log(`[Listening] Group: ${groupName} | Stream: ${streamName}`);

  // 2. Polling loop
  while (true) {
    try {
      // ioredis xreadgroup flat arguments
      const response = await redisClient.xreadgroup(
        "GROUP",
        groupName,
        consumerName,
        "COUNT",
        1,
        "BLOCK",
        2000,
        "STREAMS",
        streamName,
        ">", // ">" means give me messages that have never been delivered to any consumer in this group
      );

      // 3. ioredis returns raw nested arrays:
      // [ [ "streamName", [ [ "messageId", [ "data", "{...}", "timestamp", "..." ] ] ] ] ]
      if (response && response.length > 0) {
        const streamResults = response[0];
        const messages = streamResults[1];

        for (const [eventId, fields] of messages) {
          // Extract the 'data' field from the flat array of keys/values
          let dataString = null;
          for (let i = 0; i < fields.length; i += 2) {
            if (fields[i] === "data") {
              dataString = fields[i + 1];
              break;
            }
          }

          if (dataString) {
            const payload = JSON.parse(dataString);

            // Process the message (Awaiting ensures we don't process the next until this succeeds)
            await messageHandler(payload, eventId);

            // Acknowledge the message so Redis knows it was successfully processed
            await redisClient.xack(streamName, groupName, eventId);
          }
        }
      }
    } catch (error) {
      console.error(`[Consumer Error] Stream: ${streamName}:`, error);
      // Prevent an infinite crash loop from eating 100% CPU if Redis temporarily drops
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
};
