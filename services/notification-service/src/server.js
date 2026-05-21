import app from "./app.js";
import { logger } from "@shop/utils";
import http from "http";

// Imports updated
import { initWebSocketServer } from "./websockets/index.js";
import { startNotificationConsumers } from "./events/consumer.js";
import { startChatWorker } from "./workers/chatWorker.js";
const PORT = process.env.PORT || 4006;

const startServer = async () => {
  const server = http.createServer(app);

  // Initialize unified WebSockets (Notifications + Chat)
  initWebSocketServer(server);

  server.listen(PORT, () => {
    logger.info(`🔔 Notification Service (REST & WS) running on port ${PORT}`);
  });

  // Start Redis Consumers in background
  startNotificationConsumers().catch((err) => {
    logger.error("Failed to start Notification Consumers:", err);
  });

  // Start Redis Stream Worker for Chat persistence
  startChatWorker().catch((err) => {
    logger.error("Failed to start Chat Worker:", err);
  });
};

startServer();
