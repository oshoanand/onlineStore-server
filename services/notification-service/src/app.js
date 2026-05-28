import express from "express";
import notificationRoutes from "./routes/index.js";
import { logger } from "@shop/utils";

const app = express();

// 1. Body Parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // Added for URL-encoded payloads

// 2. Local Health Check (Crucial for Docker/AWS)
// Gateway maps: GET /api/notifications/health -> GET /health
app.get("/health", (req, res) => {
  res.status(200).json({
    service: "Notification Service",
    status: "healthy",
  });
});

// 3. REST Routes
// The Gateway stripped "/api/notifications", so this starts exactly at the root
app.use("/", notificationRoutes);

// 4. 🚨 THE "CATCH-ALL" DEBUGGER
// If the Gateway sends a route that doesn't exist, catch it here cleanly
// instead of letting Express return an HTML error page.
app.use((req, res) => {
  res.status(404).json({
    status: "error",
    message: `Notification Service Route Not Found: ${req.method} ${req.originalUrl}`,
  });
});

// // 5. Global Error Handler
// const errorHandler = (err, req, res, next) => {
//   logger.error(err.message, { stack: err.stack });

//   // Some libraries use err.status, others use err.statusCode. Handle both!
//   const statusCode = err.statusCode || err.status || 500;

//   res.status(statusCode).json({
//     status: "error",
//     message: statusCode === 500 ? "Internal Server Error" : err.message,
//   });
// };

// app.use(errorHandler);

export default app;
