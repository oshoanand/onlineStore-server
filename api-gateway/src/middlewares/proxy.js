import { createProxyMiddleware } from "http-proxy-middleware";

/**
 * Creates a robust proxy middleware for routing requests to microservices.
 * * @param {Object|string} serviceConfig - The service configuration object (e.g., { url, prefix, name }) or a target string.
 * @param {boolean} isWebSocket - Whether this proxy should handle WebSocket upgrades.
 */
export const createServiceProxy = (serviceConfig, isWebSocket = false) => {
  // Handle both string URLs (legacy) and config objects (robust pattern)
  const targetUrl =
    typeof serviceConfig === "string" ? serviceConfig : serviceConfig.url;
  const prefix =
    typeof serviceConfig === "string" ? null : serviceConfig.prefix;
  const serviceName =
    typeof serviceConfig === "string" ? targetUrl : serviceConfig.name;

  return createProxyMiddleware({
    target: targetUrl,
    changeOrigin: true,
    ws: isWebSocket,

    // 1. PATH REWRITING (Fixes the Express Fall-Through routing errors)
    pathRewrite: (path, req) => {
      if (prefix) {
        // Strips the gateway prefix (e.g., "/api/users") so the microservice
        // receives exactly the route it expects (e.g., "/auth/register")
        return path.replace(prefix, "");
      }
      return path;
    },

    // 2. HEADER INJECTION (Context passing to microservices)
    onProxyReq: (proxyReq, req, res) => {
      // SECURITY: Strip out any spoofed headers from the incoming client request
      proxyReq.removeHeader("X-User-Id");
      proxyReq.removeHeader("X-User-Role");

      // Inject the verified user context from the Gateway's auth middleware
      if (req.user) {
        proxyReq.setHeader("X-User-Id", req.user.id);
        if (req.user.role) {
          proxyReq.setHeader("X-User-Role", req.user.role);
        }
      }
    },

    // 3. ERROR HANDLING
    onError: (err, req, res) => {
      console.error(
        `[Proxy Error] Failed to reach ${serviceName}:`,
        err.message,
      );

      // Prevent crashing on WebSocket errors (res has no .status method for WS)
      if (res.writeHead && !res.headersSent) {
        res.status(502).json({
          error: "Bad Gateway",
          message: `${serviceName} is currently unavailable. Please try again later.`,
        });
      }
    },
  });
};
