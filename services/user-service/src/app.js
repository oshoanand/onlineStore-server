import express from "express";
import routes from "./routes/user.js";
import { logger } from "@shop/utils";

const app = express();

// 1. Body Parsing
// Add urlencoded to handle standard form submissions safely
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 2. Local Health Check (Crucial for Docker/AWS)
// When the Gateway pings /api/users/health, it forwards here to /health
app.get("/health", (req, res) => {
  res.status(200).json({
    service: "User Service",
    status: "healthy",
  });
});

// 3. REST Routes
// The Gateway stripped "/api/users", so this starts exactly at the root
app.use("/", routes);

// 4. Global Error Handler
// Moved to the bottom to ensure it catches errors from all middleware/routes above it
const errorHandler = (err, req, res, next) => {
  logger.error(err.message, { stack: err.stack });

  // Support both err.statusCode and err.status (different npm packages use different keys)
  const statusCode = err.statusCode || err.status || 500;

  // Hide internal server crash details from the frontend for security
  res.status(statusCode).json({
    status: "error",
    message: statusCode === 500 ? "Internal Server Error" : err.message,
  });
};

app.use(errorHandler);

export default app;
