import app from "./app.js";
import { logger } from "@shop/utils";
import { startPaymentEventConsumers } from "./events/consumer.js";

const PORT = process.env.PORT || 4005;

const startServer = async () => {
  app.listen(PORT, () => {
    logger.info(`💳 Payment Service running on port ${PORT}`);
  });

  // Start listening for OrderCreated events
  startPaymentEventConsumers().catch((err) => {
    logger.error("Failed to start Event Consumers:", err);
  });
};

startServer();
