import dotenv from "dotenv";
dotenv.config();

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
