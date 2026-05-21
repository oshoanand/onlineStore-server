import jwt from "jsonwebtoken";
import config from "../config/env.js";

/**
 * Extracts the JWT token from the Authorization header or query parameters.
 */
function extractToken(req) {
  if (
    req.headers.authorization &&
    req.headers.authorization.split(" ")[0] === "Bearer"
  ) {
    return req.headers.authorization.split(" ")[1];
  } else if (req.query && req.query.token) {
    return req.query.token;
  }
  return null;
}

/**
 * Middleware to verify JWT tokens at the API Gateway level.
 */
export const verifyToken = async (req, res, next) => {
  const token = extractToken(req);

  if (!token) {
    return res.status(401).json({
      status: "error",
      message: "Unauthorized: Missing authentication token",
    });
  }

  try {
    // 1. Verify the token using the secret from your environment config
    const decoded = jwt.verify(token, config.jwtSecret, {
      algorithms: ["HS256"], // Must be an array
    });

    // 2. CRITICAL FIX: Attach the user context to the request object.
    // The proxy.js middleware relies on this to inject X-User-Id and X-User-Role
    // into the headers before forwarding the request to your microservices.
    req.user = {
      id: decoded.id,
      role: decoded.role,
      email: decoded.email,
    };

    next();
  } catch (err) {
    console.error("[Auth Middleware Error]:", err.message);

    // Provide a clearer error message if the token simply expired
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({
        status: "error",
        message: "Unauthorized: Token has expired",
      });
    }

    // Otherwise, the token is invalid, malformed, or tampered with
    return res.status(403).json({
      status: "error",
      message: "Forbidden: Invalid token",
    });
  }
};
