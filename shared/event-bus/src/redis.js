import Redis from "ioredis";
import "dotenv/config";

const DEFAULT_TTL = 3600 * 24 * 2; // 2 days

// 1. Initialize Main Redis Client with fail-safe retry strategy
export const redisClient = new Redis({
  host: process.env.REDIS_HOST || "127.0.0.1",
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD || "",
  maxRetriesPerRequest: null, // Recommended setting for queue/stream workers
  retryStrategy(times) {
    if (times > 5) {
      console.warn("⚠️ Redis is unreachable. Switching to DB-only mode.");
      return null; // Stop retrying after 5 attempts
    }
    return Math.min(times * 100, 3000);
  },
});

// 2. Initialize Pub/Sub Clients for Socket.IO Adapter
export const pubClient = redisClient.duplicate();
export const subClient = redisClient.duplicate();

// Error Handling
redisClient.on("error", (err) =>
  console.error("Redis Client Error", err.message),
);
pubClient.on("error", (err) =>
  console.error("Redis PubClient Error", err.message),
);
subClient.on("error", (err) =>
  console.error("Redis SubClient Error", err.message),
);

const connectRedis = async () => {
  try {
    const status = await redisClient.ping();
    console.log(
      `✅ Redis Connection: ${status === "PONG" ? "Healthy" : "Unstable"}`,
    );
  } catch (err) {
    console.error("❌ Redis Connection Failed:", err.message);
  }
};

const disconnectRedis = async () => {
  try {
    await redisClient.quit();
    await pubClient.quit();
    await subClient.quit();
    console.log("🛑 Redis Connections Closed");
  } catch (err) {
    console.error("Failed to close Redis connection", err);
  }
};

// Helper to invalidate specific cache keys
const invalidateKeys = async (keys) => {
  if (!keys || keys.length === 0) return;

  const keysToDelete = Array.isArray(keys) ? keys : [keys];

  try {
    await redisClient.del(...keysToDelete);
    console.log(`🗑️ Invalidated Cache Keys: ${keysToDelete.join(", ")}`);
  } catch (err) {
    console.error("Failed to invalidate keys:", err);
  }
};

// --- Invalidate by Pattern (for Pagination) ---
const invalidatePattern = async (pattern) => {
  try {
    let cursor = "0";
    do {
      const [newCursor, keys] = await redisClient.scan(
        cursor,
        "MATCH",
        pattern,
        "COUNT",
        100,
      );

      cursor = newCursor;

      if (keys.length > 0) {
        await redisClient.del(...keys);
        console.log(
          `🗑️ Invalidated Pattern (${pattern}): ${keys.length} keys removed.`,
        );
      }
    } while (cursor !== "0");
  } catch (err) {
    console.error(`❌ Failed to invalidate pattern "${pattern}":`, err);
  }
};

// --- Generic Read-Through Cache Logic ---
const fetchCached = async (resource, id, dbQuery, ttl = DEFAULT_TTL) => {
  const key = `${resource}:${id}`;

  try {
    const cachedData = await redisClient.get(key);

    if (cachedData) {
      return JSON.parse(cachedData);
    }

    const data = await dbQuery();

    if (data) {
      await redisClient.set(key, JSON.stringify(data), "EX", ttl);
    }

    return data;
  } catch (error) {
    console.error(`Redis Error on ${key}:`, error);
    return await dbQuery();
  }
};

// --- Unique Code Generator ---
async function generateUniqueCode() {
  let isUnique = false;
  let randomCode;
  const EXPIRY_IN_SECONDS = 2 * 24 * 60 * 60;

  try {
    while (!isUnique) {
      const randomNum = Math.floor(Math.random() * 100);
      randomCode = randomNum.toString().padStart(2, "0");

      const exists = await redisClient.exists(`code:${randomCode}`);

      if (exists === 0) {
        isUnique = true;
      } else {
        console.log(`Code ${randomCode} already exists. Retrying...`);
      }
    }

    await redisClient.set(
      `code:${randomCode}`,
      "active",
      "EX",
      EXPIRY_IN_SECONDS,
      "NX",
    );

    console.log(`Successfully generated and saved unique code:${randomCode}`);
    return randomCode;
  } catch (error) {
    console.error("Redis error:", error);
    return null;
  }
}

export {
  connectRedis,
  disconnectRedis,
  invalidateKeys,
  fetchCached,
  generateUniqueCode,
  invalidatePattern,
};
