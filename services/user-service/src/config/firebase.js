import admin from "firebase-admin";
import { getMessaging } from "firebase-admin/messaging";
import { getAuth } from "firebase-admin/auth";
import { logger } from "@shop/utils";

// Pointing to the config folder we created in the notification-service root
import serviceAccount from "../serviceAccountKey.json" with { type: "json" };

// Prevent multiple initializations
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
  logger.info("[Firebase] Admin SDK Initialized");
}

const messaging = getMessaging();
const firebaseAuth = getAuth(); // Initialize Auth

const sendPushNotification = async (
  type,
  title,
  body,
  fcmToken,
  topic,
  customData = {},
) => {
  try {
    // 1. Construct the Base Message
    let message = {
      notification: {
        title: title,
        body: body,
      },
      data: {
        click_action: "FLUTTER_NOTIFICATION_CLICK",
        sentAt: new Date().toISOString(),
        url: customData.url || "/orders", // Fallback URL if none provided
        ...customData,
      },
      // 2. Android Specifics
      android: {
        priority: "high",
        notification: {
          icon: "stock_ticker_update", // Replace with your Maachh app icon name
          color: "#4D96FF",
          sound: "default",
          clickAction: "FLUTTER_NOTIFICATION_CLICK",
        },
      },
      // 3. iOS Specifics
      apns: {
        payload: {
          aps: {
            badge: 1,
            sound: "default",
          },
        },
      },
      // 4. WEB PUSH SPECIFICS
      webpush: {
        headers: {
          Urgency: "high",
        },
        notification: {
          title: title,
          body: body,
          icon: "/icons/icon-192x192.png", // Ensure these exist in your frontend public folder
          badge: "/icons/badge.png",
          requireInteraction: true,
        },
        fcmOptions: {
          link: customData.url || "/orders",
        },
      },
    };

    // 5. Set Destination
    if (type === "topic" && topic) {
      message.topic = topic;
    } else if (type === "token" && fcmToken) {
      message.token = fcmToken;
    } else {
      logger.warn("[FCM] Error: Missing Token or Topic");
      return;
    }

    // 6. Send
    const response = await messaging.send(message);
    logger.info(`[FCM] Notification sent successfully: ${response}`);
    return response;
  } catch (error) {
    // Check for invalid tokens (e.g., user uninstalled the app)
    if (
      error.code === "messaging/invalid-registration-token" ||
      error.code === "messaging/registration-token-not-registered"
    ) {
      logger.warn(`[FCM] Token is no longer valid: ${fcmToken}`);
      // In the future, you can publish an event here to tell the User Service to delete this token
    } else {
      logger.error(`[FCM] Sending Failed: ${error.message}`);
    }
  }
};

// Export firebaseAuth alongside everything else
export { admin, messaging, firebaseAuth, sendPushNotification };
