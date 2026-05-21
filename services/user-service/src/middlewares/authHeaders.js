import { UnauthorizedError } from "@shop/utils";

// ==========================================
// 1. GENERAL AUTHENTICATION (Gateway-Driven)
// ==========================================
export const requireAuth = (req, res, next) => {
  const userId = req.headers["x-user-id"];

  if (!userId) {
    throw new UnauthorizedError("Unauthorized: Missing User Context");
  }

  // Populate req.user using the trusted headers passed by the API Gateway
  req.user = {
    id: userId,
    role: req.headers["x-user-role"],
  };

  next();
};

// ==========================================
// 2. ROLE-BASED AUTHORIZATION (ADMIN ONLY)
// ==========================================
export const requireAdmin = (req, res, next) => {
  // Ensure requireAuth ran first, or check the headers directly
  const role = req.user?.role || req.headers["x-user-role"];

  if (role === "ADMINISTRATOR") {
    next();
  } else {
    // If you have a ForbiddenError in @shop/utils, use that.
    // Otherwise, create a standard error for your global error handler to catch.
    const error = new Error("Forbidden: Administrator privileges required");
    error.statusCode = 403;
    throw error;
  }
};
