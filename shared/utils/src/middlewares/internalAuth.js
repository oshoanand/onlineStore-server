import { logger } from "../logger.js"; // Adjust the path to where your logger is defined in the utils package

/**
 * Middleware to secure service-to-service communication.
 * Validates the x-internal-secret header against the environment variable.
 */
export const requireInternalAuth = (req, res, next) => {
  const secret = req.headers["x-internal-secret"];

  if (!secret || secret !== process.env.INTERNAL_API_SECRET) {
    logger.warn(
      `[Security] Blocked unauthorized internal API access attempt to ${req.originalUrl}`,
    );
    return res.status(403).json({
      status: "error",
      message: "Forbidden: Invalid or missing internal service secret.",
    });
  }

  next();
};
