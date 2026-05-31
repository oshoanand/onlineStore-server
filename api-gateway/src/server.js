import app from "./app.js";
import config from "./config/env.js";
// 🚨 IMPORT the specific proxy instance from your routes
import { wsNotificationProxy } from "./routes/index.js";

const server = app.listen(config.port, () => {
  console.log(
    `🚀 API Gateway running in ${config.env} mode on port ${config.port}`,
  );
});

// 🚨 CRITICAL WEBSOCKET FIX: Explicitly handle the TCP upgrade event
server.on("upgrade", (req, socket, head) => {
  // Check if the request is destined for the Notification Service Socket
  if (req.url.startsWith("/api/notifications/socket.io")) {
    // Pass the raw socket upgrade to the http-proxy-middleware
    wsNotificationProxy.upgrade(req, socket, head);
  } else {
    // Drop any other unrecognized WebSocket upgrade attempts to prevent memory leaks
    socket.destroy();
  }
});

process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down gracefully");
  server.close(() => {
    console.log("Process terminated");
  });
});
