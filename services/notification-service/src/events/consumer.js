// import { consumeEvents, publishEvent } from "@shop/event-bus";
// import { logger } from "@shop/utils";
// import prisma from "../config/prisma.js";
// import axios from "axios";

// // --- Services & Utils ---
// import { pushToUserWebsocket } from "../websockets/index.js";
// import { getUserDeviceTokens } from "../utils/userFetcher.js";
// import { sendPushNotification } from "../config/firebase.js";
// import { sendEmail } from "../emails/mailer.js";

// // --- Email Templates & Generators ---
// import { getWelcomeEmailTemplate } from "../emails/templates/welcome.js";
// import { getOrderPlacedTemplate } from "../emails/templates/orderPlaced.js";
// import { generateInvoicePdfBuffer } from "../emails/pdfGenerator.js";

// /**
//  * Helper function to safely format short order IDs for display purposes
//  */
// const getDisplayOrderId = (orderId) => {
//   if (!orderId) return "";
//   // If it's a standard UUID, slice the first chunk. Otherwise, return as-is (e.g., 8-digit numeric)
//   return orderId.includes("-") ? orderId.split("-")[0].toUpperCase() : orderId;
// };

// /**
//  * Helper function to map generic system events to UI notification text
//  */
// const constructNotificationData = (payload) => {
//   switch (payload.eventType) {
//     case "ORDER_PLACED":
//       return {
//         type: "ORDER",
//         title: "Order Confirmed! 🎉",
//         message: `Your order #${getDisplayOrderId(payload.orderId)} has been placed successfully.`,
//       };
//     case "ORDER_SHIPPED":
//       return {
//         type: "ORDER",
//         title: "Order Shipped 🚚",
//         message: `Your package for order #${getDisplayOrderId(payload.orderId)} is on the way!`,
//       };
//     case "ORDER_DELIVERED":
//       return {
//         type: "ORDER",
//         title: "Order Delivered ✅",
//         message: `Your order #${getDisplayOrderId(payload.orderId)} has been successfully delivered. Enjoy your purchase!`,
//       };

//     case "SUPPORT_TICKET_CREATED":
//       return {
//         type: "SUPPORT",
//         title: "We received your support message 🎉",
//         message: `Your support ticket #${payload.ticketId} has been created.`,
//       };
//     case "SUPPORT_TICKET_RESOLVED":
//       return {
//         type: "SUPPORT",
//         title: "Your Support Ticket Resolved ✅",
//         message: `Your support ticket #${payload.ticketId} has been resolved.`,
//       };
//     case "PAYMENT_FAILED":
//       return {
//         type: "ALERT",
//         title: "Payment Failed ⚠️",
//         message: `There was an issue processing your payment for order #${getDisplayOrderId(payload.orderId)}.`,
//       };
//     case "NEW_CHAT_MESSAGE":
//       return {
//         type: "CHAT",
//         title: "New Message from Support 💬",
//         message: payload.content
//           ? payload.content.substring(0, 50) + "..."
//           : "You received a new attachment.",
//       };
//     case "SYSTEM":
//     case "SystemAlert":
//       return {
//         type: payload.type || "SYSTEM_ALERT",
//         title: payload.title || "System Alert",
//         message:
//           payload.message || "A new system alert requires your attention.",
//         link: payload.link || "/admin",
//       };
//     default:
//       return null;
//   }
// };

// /**
//  * 🚨 BACKGROUND WORKER: Fetch Order + User data, generate PDF, and send Email
//  * This runs completely independently of the WebSocket/Push logic so the event loop isn't blocked.
//  */
// const processOrderEmail = async (userId, orderId) => {
//   try {
//     const internalHeaders = {
//       headers: { "x-internal-secret": process.env.INTERNAL_API_SECRET },
//     };

//     const userServiceUrl =
//       process.env.USER_SERVICE_URL || "http://user-service:4002";
//     const orderServiceUrl =
//       process.env.ORDER_SERVICE_URL || "http://order-service:4004";

//     // 1. Fetch User Data and Order Data concurrently from internal APIs
//     const [userRes, orderRes] = await Promise.all([
//       axios.get(
//         `${userServiceUrl}/api/users/internal/${userId}`,
//         internalHeaders,
//       ),
//       axios.get(
//         `${orderServiceUrl}/api/orders/internal/${orderId}`,
//         internalHeaders,
//       ),
//     ]);

//     const user = userRes.data.data;
//     const order = orderRes.data.data;

//     if (!user || !user.email) {
//       logger.warn(
//         `[Notification] Cannot send order email. User ${userId} has no email address.`,
//       );
//       return;
//     }

//     // 2. Generate HTML Template and PDF Buffer in Memory
//     const htmlContent = getOrderPlacedTemplate(order, user);
//     const pdfBuffer = await generateInvoicePdfBuffer(order, user);

//     // 3. Construct Email Payload with Attachment
//     const shortOrderId = getDisplayOrderId(order.orderId || order.id);
//     const subject = `Order Confirmation #${shortOrderId}`;
//     const attachments = [
//       {
//         filename: `Invoice_${shortOrderId}.pdf`,
//         content: pdfBuffer,
//         contentType: "application/pdf",
//       },
//     ];

//     // 4. Send it!
//     await sendEmail(user.email, subject, htmlContent, attachments);
//     logger.info(
//       `[Notification] Order confirmation email and PDF sent to ${user.email}`,
//     );
//   } catch (error) {
//     logger.error(
//       `[Notification] Failed to process order email for Order ${orderId}: ${error.response?.data?.message || error.message}`,
//     );
//   }
// };

// export const startNotificationConsumers = async () => {
//   logger.info("[Notification Service] Starting event consumers...");

//   // ============================================================================
//   // 1. USER LIFECYCLE EVENTS (Registration, Password Reset)
//   // ============================================================================
//   consumeEvents(
//     "stream:users",
//     "notification-service-group",
//     async (payload, eventId) => {
//       try {
//         if (payload.eventType === "USER_REGISTERED") {
//           const { userId, email, name } = payload.data || payload;
//           logger.info(
//             `[Notification] Processing welcome workflow for new user: ${email}`,
//           );

//           // A. Send HTML Welcome Email
//           const htmlBody = getWelcomeEmailTemplate(name || "Valued Customer");
//           await sendEmail(email, "Welcome to the Online Shop! 🎉", htmlBody);

//           // B. Send Firebase Push Notification
//           const deviceTokens = await getUserDeviceTokens(userId);
//           if (deviceTokens && deviceTokens.length > 0) {
//             const pushPromises = deviceTokens.map((token) => {
//               return sendPushNotification(
//                 "token",
//                 "Welcome Aboard! 🎉",
//                 "Your account is ready. Browse our latest products now!",
//                 token,
//                 null,
//                 { url: "/profile" },
//               );
//             });
//             await Promise.allSettled(pushPromises);
//           }
//         }
//       } catch (error) {
//         logger.error(`[Consumer Error] Failed processing user event:`, error);
//       }
//     },
//   );

//   // ============================================================================
//   // 2. OPERATIONAL EVENTS (Orders, Shipping, Alerts)
//   // ============================================================================
//   consumeEvents(
//     "stream:notifications",
//     "notification-service-group",
//     async (payload, eventId) => {
//       try {
//         const notifData = constructNotificationData(payload);
//         if (!notifData) return;

//         // ==========================================
//         // 🚨 TRIGGER ASYNC EMAIL & PDF GENERATOR
//         // ==========================================
//         // Triggers on explicit placement or matching automated confirmation patterns
//         if (
//           (payload.eventType === "ORDER_PLACED" ||
//             (payload.eventType === "SYSTEM" &&
//               payload.title?.includes("Confirmed"))) &&
//           payload.userId &&
//           payload.orderId
//         ) {
//           // Fire and forget: Do not await so it runs in background
//           processOrderEmail(payload.userId, payload.orderId).catch((err) =>
//             logger.error(
//               `[Background Task Error] Email generation failed: ${err.message}`,
//             ),
//           );
//         }

//         // ==========================================
//         // A. ADMIN BROADCAST ALERTS (Supports Role + Targets flags)
//         // ==========================================
//         if (
//           payload.targetRole === "ADMINISTRATOR" ||
//           payload.target === "ADMINS"
//         ) {
//           logger.info(
//             `[Notification] Processing Admin Broadcast: ${notifData.title}`,
//           );

//           const userServiceUrl =
//             process.env.USER_SERVICE_URL || "http://user-service:4002";
//           const { data: adminResponse } = await axios.get(
//             `${userServiceUrl}/api/users/internal/admins`,
//             {
//               headers: { "x-internal-secret": process.env.INTERNAL_API_SECRET },
//             },
//           );

//           const admins = adminResponse.data || [];

//           for (const admin of admins) {
//             const adminId = admin.id;

//             // 1. Save to DB
//             const savedNotif = await prisma.notification.create({
//               data: {
//                 userId: adminId,
//                 title: notifData.title,
//                 message: notifData.message,
//                 type: notifData.type,
//                 link: notifData.link || null,
//               },
//             });

//             // 2. WebSocket
//             pushToUserWebsocket(adminId, {
//               type: "NEW_NOTIFICATION",
//               data: savedNotif,
//             });

//             // 3. FCM Push
//             const userPresence = await prisma.userPresence.findUnique({
//               where: { userId: adminId },
//             });
//             if (!userPresence || !userPresence.isOnline) {
//               const deviceTokens = await getUserDeviceTokens(adminId);
//               if (deviceTokens && deviceTokens.length > 0) {
//                 const pushPromises = deviceTokens.map((token) =>
//                   sendPushNotification(
//                     "token",
//                     notifData.title,
//                     notifData.message,
//                     token,
//                     null,
//                     { url: notifData.link || "/admin" },
//                   ),
//                 );
//                 await Promise.allSettled(pushPromises);
//               }
//             }
//           }
//           return; // Done with admin broadcast, exit early
//         }

//         // ==========================================
//         // B. STANDARD SINGLE-USER NOTIFICATIONS
//         // ==========================================
//         const userId = payload.userId || payload.data?.userId;
//         if (!userId) return;

//         // 🚨 FIXED: Calculate Deep Link for UI redirection based on event context
//         let deepLink = notifData.link || "/profile";

//         if (payload.orderId) {
//           deepLink = `/profile/orders`;
//         } else if (payload.eventType === "NEW_CHAT_MESSAGE") {
//           deepLink = `/chat/${payload.roomId}`;
//         } else if (payload.ticketId) {
//           // Directs the user to their specific support ticket tracking page
//           deepLink = `/support/tickets/${payload.ticketId}`;
//         }

//         // 1. Save to Database
//         const savedNotif = await prisma.notification.create({
//           data: {
//             userId,
//             title: notifData.title,
//             message: notifData.message,
//             type: notifData.type,
//             link: deepLink,
//           },
//         });

//         // 2. Real-time WebSocket Push (Fastest)
//         pushToUserWebsocket(userId, {
//           type: "NEW_NOTIFICATION",
//           data: savedNotif,
//         });

//         // 3. FCM Mobile/Web Push (If user is not actively looking at the app)
//         const userPresence = await prisma.userPresence.findUnique({
//           where: { userId },
//         });

//         if (!userPresence || !userPresence.isOnline) {
//           const deviceTokens = await getUserDeviceTokens(userId);

//           if (deviceTokens && deviceTokens.length > 0) {
//             const pushPromises = deviceTokens.map((token) => {
//               return sendPushNotification(
//                 "token",
//                 notifData.title,
//                 notifData.message,
//                 token,
//                 null,
//                 { url: deepLink },
//               );
//             });

//             await Promise.allSettled(pushPromises);
//             logger.info(
//               `[Notification] Sent Offline FCM Push to User: ${userId}`,
//             );
//           }
//         } else {
//           logger.info(
//             `[Notification] Skipped FCM Push. User ${userId} is currently Online (handled by WebSocket).`,
//           );
//         }
//       } catch (error) {
//         const safeErrorMessage =
//           error.response?.data?.message || error.message || "Unknown Error";
//         logger.error(
//           `[Consumer Error] Failed processing notification event: ${safeErrorMessage}`,
//         );
//       }
//     },
//   );
// };

import { consumeEvents, publishEvent } from "@shop/event-bus";
import { logger } from "@shop/utils";
import prisma from "../config/prisma.js";
import axios from "axios";

// --- Services & Utils ---
import { pushToUserWebsocket } from "../websockets/index.js";
import { getUserDeviceTokens } from "../utils/userFetcher.js";
import { sendPushNotification } from "../config/firebase.js";
import { sendEmail } from "../emails/mailer.js";
import { redisClient } from "@shop/event-bus/src/redis.js"; // 🚨 ADDED REDIS IMPORT

// --- Email Templates & Generators ---
import { getWelcomeEmailTemplate } from "../emails/templates/welcome.js";
import { getOrderPlacedTemplate } from "../emails/templates/orderPlaced.js";
import { generateInvoicePdfBuffer } from "../emails/pdfGenerator.js";

const getDisplayOrderId = (orderId) => {
  if (!orderId) return "";
  return orderId.includes("-") ? orderId.split("-")[0].toUpperCase() : orderId;
};

const constructNotificationData = (payload) => {
  switch (payload.eventType) {
    case "ORDER_PLACED":
      return {
        type: "ORDER",
        title: "Заказ подтвержден! 🎉",
        message: `Ваш заказ #${getDisplayOrderId(payload.orderId)} успешно оформлен.`,
      };
    case "ORDER_SHIPPED":
      return {
        type: "ORDER",
        title: "Заказ отправлен 🚚",
        message: `Ваш заказ #${getDisplayOrderId(payload.orderId)} передан в доставку!`,
      };
    case "ORDER_DELIVERED":
      return {
        type: "ORDER",
        title: "Заказ доставлен ✅",
        message: `Ваш заказ #${getDisplayOrderId(payload.orderId)} успешно доставлен. Спасибо за покупку!`,
      };
    case "SUPPORT_TICKET_CREATED":
      return {
        type: "SUPPORT",
        title: "Обращение получено 🎉",
        message: `Ваш запрос #${payload.ticketId} зарегистрирован.`,
      };
    case "SUPPORT_TICKET_RESOLVED":
      return {
        type: "SUPPORT",
        title: "Вопрос решен ✅",
        message: `Ваше обращение #${payload.ticketId} успешно закрыто.`,
      };
    case "PAYMENT_FAILED":
      return {
        type: "ALERT",
        title: "Ошибка оплаты ⚠️",
        message: `Произошла ошибка при оплате заказа #${getDisplayOrderId(payload.orderId)}.`,
      };
    case "SYSTEM":
    case "SystemAlert":
      return {
        type: payload.type || "SYSTEM_ALERT",
        title: payload.title || "Системное уведомление",
        message: payload.message || "У вас новое системное сообщение.",
        link: payload.link || "/profile",
      };
    default:
      return null;
  }
};

// 🚨 HELPER: Broadcast alerts to all System Admins
const broadcastToAdmins = async (notifData) => {
  try {
    const userServiceUrl =
      process.env.USER_SERVICE_URL || "http://localhost:4002";
    const { data: adminResponse } = await axios.get(
      `${userServiceUrl}/api/users/internal/admins`,
      { headers: { "x-internal-secret": process.env.INTERNAL_API_SECRET } },
    );

    const admins = adminResponse?.data || [];

    for (const admin of admins) {
      const adminId = admin.id;

      // 1. Save to DB
      const savedNotif = await prisma.notification.create({
        data: {
          userId: adminId,
          title: notifData.title,
          message: notifData.message,
          type: notifData.type,
          link: notifData.link || "/dashboard",
        },
      });

      // 2. WebSocket Push
      pushToUserWebsocket(adminId, {
        type: "NEW_NOTIFICATION",
        data: savedNotif,
      });

      // 3. FCM Push (Using Redis Presence Check!)
      const isOnline = await redisClient.sismember("online_users", adminId);
      if (!isOnline) {
        const deviceTokens = await getUserDeviceTokens(adminId);
        if (deviceTokens && deviceTokens.length > 0) {
          const pushPromises = deviceTokens.map((token) =>
            sendPushNotification(
              "token",
              notifData.title,
              notifData.message,
              token,
              null,
              { url: notifData.link || "/dashboard" },
            ),
          );
          await Promise.allSettled(pushPromises);
        }
      }
    }
  } catch (error) {
    logger.error(`[Admin Broadcast Error]: ${error.message}`);
  }
};

const processOrderEmail = async (userId, orderId) => {
  try {
    const internalHeaders = {
      headers: { "x-internal-secret": process.env.INTERNAL_API_SECRET },
    };

    const userServiceUrl =
      process.env.USER_SERVICE_URL || "http://localhost:4002";
    const orderServiceUrl =
      process.env.ORDER_SERVICE_URL || "http://localhost:4004";

    const [userRes, orderRes] = await Promise.all([
      axios.get(
        `${userServiceUrl}/api/users/internal/${userId}`,
        internalHeaders,
      ),
      axios.get(
        `${orderServiceUrl}/api/orders/internal/${orderId}`,
        internalHeaders,
      ),
    ]);

    const user = userRes.data.data;
    const order = orderRes.data.data;

    if (!user || !user.email) return;

    const htmlContent = getOrderPlacedTemplate(order, user);
    const pdfBuffer = await generateInvoicePdfBuffer(order, user);

    const shortOrderId = getDisplayOrderId(order.orderId || order.id);
    const subject = `Order Confirmation #${shortOrderId}`;
    const attachments = [
      {
        filename: `Invoice_${shortOrderId}.pdf`,
        content: pdfBuffer,
        contentType: "application/pdf",
      },
    ];

    await sendEmail(user.email, subject, htmlContent, attachments);
  } catch (error) {
    logger.error(
      `[Notification] Failed to process order email: ${error.message}`,
    );
  }
};

export const startNotificationConsumers = async () => {
  logger.info("[Notification Service] Starting event consumers...");

  // ============================================================================
  // 1. USER LIFECYCLE EVENTS (Registration, Password Reset)
  // ============================================================================

  consumeEvents(
    "stream:users",
    "notification-service-group",
    async (payload, eventId) => {
      try {
        if (payload.eventType === "USER_REGISTERED") {
          const { userId, email, name } = payload.data || payload;
          logger.info(
            `[Notification] Processing welcome workflow for new user: ${email}`,
          );

          // A. Send HTML Welcome Email
          const htmlBody = getWelcomeEmailTemplate(name || "Valued Customer");
          await sendEmail(email, "Welcome to the Online Shop! 🎉", htmlBody);

          // B. Send Firebase Push Notification
          const deviceTokens = await getUserDeviceTokens(userId);
          if (deviceTokens && deviceTokens.length > 0) {
            const pushPromises = deviceTokens.map((token) => {
              return sendPushNotification(
                "token",
                "Welcome Aboard! 🎉",
                "Your account is ready. Browse our latest products now!",
                token,
                null,
                { url: "/profile" },
              );
            });
            await Promise.allSettled(pushPromises);
          }
        }
      } catch (error) {
        logger.error(`[Consumer Error] Failed processing user event:`, error);
      }
    },
  );

  // ============================================================================
  // 2. OPERATIONAL EVENTS (Orders, Shipping, Alerts)
  // ============================================================================
  consumeEvents(
    "stream:notifications",
    "notification-service-group",
    async (payload) => {
      try {
        const notifData = constructNotificationData(payload);
        if (!notifData) return;

        // ==========================================
        // 🚨 DUAL ROUTING: Alert Admins AND Customers for Orders & Tickets
        // ==========================================
        if (payload.eventType === "ORDER_PLACED") {
          await broadcastToAdmins({
            type: "ORDER",
            title: "Новый заказ! 📦",
            message: `Поступил новый заказ #${getDisplayOrderId(payload.orderId)}.`,
            link: `/orders/${payload.orderId}`,
          });
        } else if (payload.eventType === "SUPPORT_TICKET_CREATED") {
          await broadcastToAdmins({
            type: "SUPPORT",
            title: "Новое обращение 🎫",
            message: `Поступил новый запрос в поддержку #${payload.ticketId}.`,
            link: `/support/${payload.ticketId}`,
          });
        }

        // Trigger Email Generation
        if (
          payload.eventType === "ORDER_PLACED" &&
          payload.userId &&
          payload.orderId
        ) {
          processOrderEmail(payload.userId, payload.orderId).catch((err) =>
            logger.error(`[Email Generator Error]: ${err.message}`),
          );
        }

        // Explicit Admin-Only Broadcasts
        if (
          payload.targetRole === "ADMINISTRATOR" ||
          payload.target === "ADMINS"
        ) {
          await broadcastToAdmins(notifData);
          return; // Exit here so we don't accidentally send it to an undefined customer
        }

        // ==========================================
        // STANDARD SINGLE-USER NOTIFICATIONS
        // ==========================================
        const userId = payload.userId || payload.data?.userId;
        if (!userId) return;

        let deepLink = notifData.link || "/profile";
        if (payload.orderId) deepLink = `/profile/orders`;
        if (payload.ticketId) deepLink = `/support/tickets/${payload.ticketId}`;

        // 1. Save to Database
        const savedNotif = await prisma.notification.create({
          data: {
            userId,
            title: notifData.title,
            message: notifData.message,
            type: notifData.type,
            link: deepLink,
          },
        });

        // 2. Real-time WebSocket Push
        pushToUserWebsocket(userId, {
          type: "NEW_NOTIFICATION",
          data: savedNotif,
        });

        // 3. FCM Push (🚨 FIXED: Using Redis to check online presence!)
        const isOnline = await redisClient.sismember("online_users", userId);

        if (!isOnline) {
          const deviceTokens = await getUserDeviceTokens(userId);
          if (deviceTokens && deviceTokens.length > 0) {
            const pushPromises = deviceTokens.map((token) =>
              sendPushNotification(
                "token",
                notifData.title,
                notifData.message,
                token,
                null,
                { url: deepLink },
              ),
            );
            await Promise.allSettled(pushPromises);
          }
        }
      } catch (error) {
        logger.error(
          `[Consumer Error] Failed processing notification: ${error.message}`,
        );
      }
    },
  );
};
