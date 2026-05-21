import { UnauthorizedError } from "@shop/utils";

export const requireAuth = (req, res, next) => {
  const userId = req.headers["x-user-id"];
  if (!userId)
    throw new UnauthorizedError("Unauthorized: Missing User Context");
  req.user = { id: userId, role: req.headers["x-user-role"] };
  next();
};

export const requireAdmin = (req, res, next) => {
  if (req.user?.role !== "ADMINISTRATOR") {
    throw new UnauthorizedError("Forbidden: Admin access required");
  }
  next();
};
