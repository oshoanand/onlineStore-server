import express from "express";
import orderRoutes from "./routes/order.js";
import { logger } from "@shop/utils";

// const errorHandler = (err, req, res, next) => {
//   logger.error(err.message, { stack: err.stack });
//   const statusCode = err.statusCode || 500;
//   res.status(statusCode).json({ status: "error", message: err.message });
// };

const app = express();
app.use(express.json());

// API Routes
app.use("/", orderRoutes);

// app.use(errorHandler);

export default app;
