import app from "./app.js";
import config from "./config/env.js";

const server = app.listen(config.port, () => {
  console.log(
    `🚀 API Gateway running in ${config.env} mode on port ${config.port}`,
  );
});

server.on("upgrade", (req, socket, head) => {
  // WebSocket upgrade handling logic can go here if needed directly at the server level
});

process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down gracefully");
  server.close(() => {
    console.log("Process terminated");
  });
});
