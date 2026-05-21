import express from "express";
import helmet from "helmet";
import cors from "cors";
import morgan from "morgan";
import { globalLimiter } from "./middlewares/rateLimit.js";
import routes from "./routes/index.js";
import errorHandler from "./middlewares/error.js";

const app = express();

// 1. Health Check (Must be TOP level, before rate limiters)
// This ensures Docker/AWS load balancers can ping it without getting blocked
app.get("/health", (req, res) => {
  res.status(200).json({ status: "Gateway is healthy" });
});

// 2. Global Security & Logging
app.use(helmet());
app.use(cors());
app.use(morgan("dev"));
app.use(globalLimiter);

// 🚨 CRITICAL PROXY TRAP AVOIDED 🚨
// Do NOT add `app.use(express.json())` or `app.use(express.urlencoded())` here!
// Parsing the body at the Gateway level consumes the data stream and will cause
// http-proxy-middleware to hang or send empty bodies to your microservices.

// 3. Mount Routes
// Mounted at the root "/" because routes/index.js already defines the "/api/..." prefixes
app.use("/", routes);

// 4. Global Error Handler
app.use(errorHandler);

export default app;
