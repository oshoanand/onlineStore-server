import express from "express";
import path from "path";
import { logger } from "@shop/utils";
// import Prisma from "../src/config/prisma.js";

import productRoutes from "./routes/product.js";
import categoryRoutes from "./routes/category.js";
import shippingRoutes from "./routes/shipping.js";

const app = express();

// 1. Body Parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 2. Local Health Check
app.get("/health", (req, res) => {
  res.status(200).json({
    service: "Product Service",
    status: "healthy",
  });
});

// ==========================================
// 3. REST ROUTES (CRITICAL FIX HERE)
// ==========================================
// We mount categoryRoutes twice to catch both Gateway prefixes:
// 1. Catches: /api/products/public/categories/all/tree (From Storefront)
app.use("/public/categories", categoryRoutes);

// 2. Catches: /api/products/categories/admin/all (From Admin Panel)
app.use("/categories", categoryRoutes);

app.use("/public/shipping", shippingRoutes); // Catches: /api/products/public/shipping/calculate
app.use("/shipping", shippingRoutes);

app.use("/", productRoutes);

// 4. Unmatched Route Handler (404)
app.use((req, res, next) => {
  const error = new Error(`Route not found: ${req.originalUrl}`);
  error.statusCode = 404;
  next(error);
});

// 5. Global Error Handler
// (I highly recommend uncommenting this in your actual file so
// your frontend receives clean JSON errors instead of HTML stack traces!)
// const errorHandler = (err, req, res, next) => {
//   logger.error(`[Product Service Error]: ${err.message}`, { stack: err.stack });

//   let statusCode = err.statusCode || err.status || 500;
//   let message = err.message || "Internal Server Error";

//   if (err instanceof Prisma.PrismaClientKnownRequestError) {
//     if (err.code === "P2002") {
//       statusCode = 409;
//       message = `Unique constraint failed on field: ${err.meta?.target}`;
//     } else if (err.code === "P2025") {
//       statusCode = 404;
//       message = "Requested record not found in the database";
//     } else {
//       statusCode = 400;
//       message = `Database error: ${err.message}`;
//     }
//   } else if (err instanceof Prisma.PrismaClientValidationError) {
//     statusCode = 400;
//     message = "Invalid data provided to the database";
//   }

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
