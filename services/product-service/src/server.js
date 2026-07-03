import "./env-loader.js";
import app from "./app.js";
import { logger } from "@shop/utils";
import { startProductEventConsumer } from "./events/consumer.js";

const PORT = process.env.PORT || 4003;

const startServer = async () => {
  app.listen(PORT, () => {
    logger.info(`📦 Product Service running on port ${PORT}`);
  });

  // Start listening to the Redis Event Stream in the background
  startProductEventConsumer().catch((err) => {
    logger.error("Failed to start Event Consumer:", err);
  });
};

startServer();
