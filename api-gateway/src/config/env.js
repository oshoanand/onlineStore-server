import dotenv from "dotenv";
import path from "path";

// 1. Calculate paths relative to where the Node process started (api-gateway)
const localEnvPath = path.resolve(process.cwd(), ".env");

// 🚨 Notice this is "../.env" (one level up), not "../../"
const rootEnvPath = path.resolve(process.cwd(), "../.env");

// 2. Load the Root .env first (Shared Secrets & URLs)
dotenv.config({ path: rootEnvPath });

// 3. Load the Local .env second (Specific PORT)
dotenv.config({ path: localEnvPath });

export default {
  port: process.env.PORT || 4001,
  env: process.env.NODE_ENV || "development",
  jwtSecret: process.env.JWT_SECRET,
  services: {
    users: process.env.USER_SERVICE_URL,
    products: process.env.PRODUCT_SERVICE_URL,
    orders: process.env.ORDER_SERVICE_URL,
    payments: process.env.PAYMENT_SERVICE_URL,
    notifications: process.env.NOTIFICATION_SERVICE_URL,
  },
};
