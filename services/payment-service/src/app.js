import express from "express";
import paymentRoutes from "./routes/payment.js";
import { logger } from "@shop/utils";

const errorHandler = (err, req, res, next) => {
  logger.error(err.message, { stack: err.stack });
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({ status: "error", message: err.message });
};

const app = express();

// Notice: app.use(express.json()) is NOT here globally.
// It is handled inside payment.routes.js to protect the Stripe Webhook route.

// API Routes
app.use("/", paymentRoutes); // Mapped to /api/payments at Gateway

app.use(errorHandler);

export default app;
