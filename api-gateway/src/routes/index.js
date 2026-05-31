// import express from "express";
// import { createProxyMiddleware } from "http-proxy-middleware";
// import { createServiceProxy } from "../middlewares/proxy.js";
// import { verifyToken } from "../middlewares/auth.js";
// import { authLimiter } from "../middlewares/rateLimit.js";
// import config from "../config/env.js";

// const router = express.Router();

// const services = {
//   users: {
//     name: "User Service",
//     url: config.services.users,
//     prefix: "/api/users",
//   },
//   products: {
//     name: "Product Service",
//     url: config.services.products,
//     prefix: "/api/products",
//   },
//   orders: {
//     name: "Order Service",
//     url: config.services.orders,
//     prefix: "/api/orders",
//   },
//   payments: {
//     name: "Payment Service",
//     url: config.services.payments,
//     prefix: "/api/payments",
//   },
//   notifications: {
//     name: "Notification Service",
//     url: config.services.notifications,
//     prefix: "/api/notifications",
//   },
// };

// // ==========================================
// // 1. PUBLIC & WEBSOCKET ROUTES (No Gateway JWT Required)
// // ==========================================

// router.use("/api/users/auth", authLimiter, createServiceProxy(services.users));
// router.use("/api/products/public", createServiceProxy(services.products));
// router.use("/api/users/articles/public", createServiceProxy(services.users));

// // 🚨 CRITICAL FIX: Explicitly proxy Socket.IO without path modifications.
// // This prevents path rewriting anomalies from causing 404 handshaking loops on the backend.
// router.use(
//   "/api/notifications/socket.io",
//   createProxyMiddleware({
//     target: config.services.notifications,
//     changeOrigin: true,
//     ws: true,
//   }),
// );

// // ==========================================
// // 2. PROTECTED ROUTES (Requires Gateway JWT)
// // ==========================================
// router.use(verifyToken);

// router.use("/api/users", createServiceProxy(services.users));
// router.use("/api/orders", createServiceProxy(services.orders));
// router.use("/api/payments", createServiceProxy(services.payments));
// router.use("/api/products", createServiceProxy(services.products));

// // Standard REST requests to Notification Service (e.g., GET /api/notifications)
// router.use("/api/notifications", createServiceProxy(services.notifications));

// export default router;
import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import { createServiceProxy } from "../middlewares/proxy.js";
import { verifyToken } from "../middlewares/auth.js";
import { authLimiter } from "../middlewares/rateLimit.js";
import config from "../config/env.js";

const router = express.Router();

const services = {
  users: {
    name: "User Service",
    url: config.services.users,
    prefix: "/api/users",
  },
  products: {
    name: "Product Service",
    url: config.services.products,
    prefix: "/api/products",
  },
  orders: {
    name: "Order Service",
    url: config.services.orders,
    prefix: "/api/orders",
  },
  payments: {
    name: "Payment Service",
    url: config.services.payments,
    prefix: "/api/payments",
  },
  notifications: {
    name: "Notification Service",
    url: config.services.notifications,
    prefix: "/api/notifications",
  },
};

// 🚨 1. CREATE THE PROXY AS A STANDALONE VARIABLE EXPORT
export const wsNotificationProxy = createProxyMiddleware({
  target: config.services.notifications,
  changeOrigin: true,
  ws: true,
});

// ==========================================
// 1. PUBLIC & WEBSOCKET ROUTES
// ==========================================

router.use("/api/users/auth", authLimiter, createServiceProxy(services.users));
router.use("/api/products/public", createServiceProxy(services.products));
router.use("/api/users/articles/public", createServiceProxy(services.users));

// 🚨 2. USE THE EXPORTED PROXY FOR HTTP HANDSHAKES
router.use("/api/notifications/socket.io", wsNotificationProxy);

// ==========================================
// 2. PROTECTED ROUTES (Requires Gateway JWT)
// ==========================================
router.use(verifyToken);

router.use("/api/users", createServiceProxy(services.users));
router.use("/api/orders", createServiceProxy(services.orders));
router.use("/api/payments", createServiceProxy(services.payments));
router.use("/api/products", createServiceProxy(services.products));

// Standard REST requests
router.use("/api/notifications", createServiceProxy(services.notifications));

export default router;
