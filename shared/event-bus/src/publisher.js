import { redisClient } from "./redis.js";

/**
 * Publishes an event to a Redis Stream.
 * @param {string} streamName - e.g., 'stream:orders'
 * @param {object} payload - The data to send
 */
export const publishEvent = async (streamName, payload) => {
  try {
    // xadd takes arguments flatly: key, id, field1, value1, field2, value2
    const messageId = await redisClient.xadd(
      streamName,
      "*",
      "data",
      JSON.stringify(payload),
      "timestamp",
      Date.now().toString(),
    );

    console.log(`[Event Published] Stream: ${streamName} | ID: ${messageId}`);
    return messageId;
  } catch (error) {
    console.error(`[Event Publish Error] on ${streamName}:`, error);
    throw error;
  }
};
