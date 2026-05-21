import express from "express";
import path from "path";
import { logger } from "@shop/utils";
import Prisma from "../src/config/prisma.js";

// Corrected Imports based on established file structure
import productRoutes from "./routes/product.js";
import categoryRoutes from "./routes/category.js";
import shippingRoutes from "./routes/shipping.js";

const app = express();

// 1. Body Parsing
app.use(express.json());
// Allow form-data parsing for non-file text fields (Multer handles the file fields)
app.use(express.urlencoded({ extended: true }));

// 2. Static File Serving (Optional: Commented out if using MinIO as configured)
// app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

// 3. Local Health Check (Crucial for Docker/AWS/Kubernetes)
// When the Gateway pings /api/products/health, it forwards here to /health
app.get("/health", (req, res) => {
  res.status(200).json({
    service: "Product Service",
    status: "healthy",
  });
});

// 4. REST Routes
// Since the Gateway strips "/api/products", requests come in at "/"
app.use("/categories", categoryRoutes); // e.g., /api/products/categories
app.use("/", productRoutes); // e.g., /api/products/public/all
app.use("/shipping", shippingRoutes); // e.g., /api/products/shipping/calculate
// 5. Unmatched Route Handler (404)
app.use((req, res, next) => {
  const error = new Error(`Route not found: ${req.originalUrl}`);
  error.statusCode = 404;
  next(error);
});

// 6. Global Error Handler
// Moved to the bottom so it catches errors from everything above it
// const errorHandler = (err, req, res, next) => {
//   logger.error(`[Product Service Error]: ${err.message}`, { stack: err.stack });

//   let statusCode = err.statusCode || err.status || 500;
//   let message = err.message || "Internal Server Error";

//   // --- Enhanced Prisma Database Error Handling ---
//   if (err instanceof Prisma.PrismaClientKnownRequestError) {
//     if (err.code === "P2002") {
//       statusCode = 409; // Conflict
//       message = `Unique constraint failed on field: ${err.meta?.target}`;
//     } else if (err.code === "P2025") {
//       statusCode = 404; // Not Found
//       message = "Requested record not found in the database";
//     } else {
//       statusCode = 400; // Bad Request
//       message = `Database error: ${err.message}`;
//     }
//   } else if (err instanceof Prisma.PrismaClientValidationError) {
//     statusCode = 400;
//     message = "Invalid data provided to the database";
//   }

//   // Hide internal server crash details from the frontend for security in production
//   if (statusCode === 500 && process.env.NODE_ENV === "production") {
//     message = "Internal Server Error";
//   }

//   res.status(statusCode).json({
//     success: false,
//     message,
//   });
// };

// app.use(errorHandler);

export default app;
