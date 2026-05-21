import express from "express";
import { createPaymentIntent, stripeWebhook } from "../controllers/payment.js";
import { UnauthorizedError } from "@shop/utils";

const requireAuth = (req, res, next) => {
  const userId = req.headers["x-user-id"];
  if (!userId)
    throw new UnauthorizedError("Unauthorized: Missing User Context");
  next();
};

const router = express.Router();

// 1. STRIPE WEBHOOK (Must be RAW buffer for cryptographic signature verification)
router.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  stripeWebhook,
);

// 2. CLIENT ROUTES (Standard JSON)
router.use(express.json()); // JSON parsing applied ONLY to routes below this line
router.post("/:orderId/intent", requireAuth, createPaymentIntent);

export default router;
