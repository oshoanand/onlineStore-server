import "./env-loader.js";
import app from "./app.js";
import { connectRedis, disconnectRedis } from "@shop/event-bus";
import { logger, initializeMinio } from "@shop/utils";
import prisma from "./config/prisma.js";

const PORT = process.env.PORT || 3001;

// ==========================================
// 1. GLOBAL ERROR HANDLERS (CRITICAL FOR DOCKER)
// ==========================================
process.on("uncaughtException", (error) => {
  logger.error("❌ UNCAUGHT EXCEPTION: Shutting down...", error);
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  logger.error("❌ UNHANDLED REJECTION: Shutting down...", { reason });
  process.exit(1);
});

async function startServer() {
  try {
    // ==========================================
    // 2. ESTABLISH INFRASTRUCTURE CONNECTIONS
    // ==========================================

    // Connect to Redis Event Bus & Cache
    await connectRedis();

    // Connect to PostgreSQL Database
    await prisma.$connect();
    logger.info("✅ Database Connection: Healthy");

    // Initialize MinIO Object Storage (Creates bucket if it doesn't exist)
    await initializeMinio();
    logger.info("✅ Storage Container: Initialized");

    // ==========================================
    // 3. START HTTP SERVER
    // ==========================================
    const server = app.listen(PORT, () => {
      logger.info(`👤 User Service running on port ${PORT}`);
    });

    // ==========================================
    // 4. GRACEFUL SHUTDOWN (K8S / DOCKER SAFE)
    // ==========================================
    const gracefulShutdown = async (signal) => {
      logger.info(`\n${signal} received. Shutting down gracefully...`);

      // Stop accepting new HTTP requests immediately
      server.close(async () => {
        logger.info("HTTP server closed.");

        try {
          // Close DB and Redis connections cleanly
          await prisma.$disconnect();
          await disconnectRedis();

          logger.info("Goodbye! 👋");
          process.exit(0);
        } catch (shutdownError) {
          logger.error("Error during shutdown cleanup:", shutdownError);
          process.exit(1);
        }
      });

      // Force shutdown if connections take too long to close (e.g., 10 seconds)
      setTimeout(() => {
        logger.error("Forcing shutdown due to timeout.");
        process.exit(1);
      }, 10000).unref();
    };

    process.on("SIGINT", () => gracefulShutdown("SIGINT"));
    process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  } catch (error) {
    logger.error("❌ Fatal Error during startup:", error);
    process.exit(1);
  }
}

startServer();
