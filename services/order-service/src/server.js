import app from "./app.js";
import { logger } from "@shop/utils";
import { startOrderEventConsumers } from "./events/consumer.js";

const PORT = process.env.PORT || 4004;

const startServer = async () => {
  app.listen(PORT, () => {
    logger.info(`🛒 Order Service running on port ${PORT}`);
  });

  // Start background Redis Stream listeners
  startOrderEventConsumers().catch((err) => {
    logger.error("Failed to start Event Consumers:", err);
  });
};

startServer();
