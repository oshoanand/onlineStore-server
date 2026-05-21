import prisma from "../config/prisma.js";
import { NotFoundError, BadRequestError } from "@shop/utils";

// 🚨 FIX: Import Firebase messaging to resolve the undefined error in registerDeviceToken
// Adjust this path if your firebase admin initialization is located elsewhere
import { messaging } from "../config/firebase.js";

// ==========================================
// 1. PUBLIC / PROTECTED USER ROUTES
// ==========================================
export const getProfile = async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: { addresses: true },
    });

    if (!user) throw new NotFoundError("User not found");

    user.passwordHash = undefined;
    res.status(200).json({ status: "success", data: user });
  } catch (error) {
    next(error);
  }
};

export const addAddress = async (req, res, next) => {
  try {
    const { street, city, state, zipCode, isDefault } = req.body;

    if (isDefault) {
      // Unset previous defaults
      await prisma.address.updateMany({
        where: { userId: req.user.id, isDefault: true },
        data: { isDefault: false },
      });
    }

    const address = await prisma.address.create({
      data: {
        userId: req.user.id,
        street,
        city,
        state,
        zipCode,
        isDefault: isDefault || false,
      },
    });

    res.status(201).json({ status: "success", data: address });
  } catch (error) {
    next(error);
  }
};

export const registerDeviceToken = async (req, res, next) => {
  try {
    const { token, mobile } = req.body;

    if (!token) return res.status(400).json({ message: "Token is required" });
    if (!mobile)
      return res
        .status(401)
        .json({ message: "Unauthorized: Mobile is required" });

    console.log(`[FCM] Processing token for user ${mobile}`);

    // 1. Update User in Database
    const updatedUser = await prisma.user.update({
      where: { mobile: mobile },
      data: {
        fcmToken: token,
        updatedAt: new Date(), // Good for tracking active devices
      },
    });

    // 2. Define Topics
    const topicsToSubscribe = [];

    // A. Personal Topic
    const personalTopic = `user_${mobile}`;
    topicsToSubscribe.push(personalTopic);

    // B. Role-based Topic
    if (updatedUser.role === "CUSTOMER") {
      topicsToSubscribe.push(
        process.env.CUSTOMER_FCM_TOPIC || "onlineshop_customer_topic",
      );
    } else {
      topicsToSubscribe.push(
        process.env.SELLER_FCM_TOPIC || "onlineshop_seller_topic",
      );
    }

    // 3. Execute Subscriptions in Parallel
    const subscriptionPromises = topicsToSubscribe.map((topic) =>
      messaging
        .subscribeToTopic(token, topic)
        .then(() => ({ status: "fulfilled", topic }))
        .catch((err) => ({ status: "rejected", topic, reason: err })),
    );

    const results = await Promise.allSettled(subscriptionPromises);

    // Log results for debugging
    results.forEach((res) => {
      if (res.status === "fulfilled") {
        console.log(`✅ Subscribed to ${res.value.topic}`);
      } else {
        console.error(
          `❌ Failed to subscribe to ${res.reason.topic}:`,
          res.reason.reason,
        );
      }
    });

    return res.status(200).json({
      success: true,
      message: "Token saved and subscriptions updated",
      topics: topicsToSubscribe,
    });
  } catch (error) {
    console.error("Error saving FCM token:", error);
    // 🚨 FIX: Pass to global error handler instead of hardcoded 500
    next(error);
  }
};

// ==========================================
// 2. INTERNAL SERVICE-TO-SERVICE ROUTES
// ==========================================

/**
 * 🚨 NEW: Provides safe user data to other microservices (e.g. Notification Service)
 * Called via /internal/:id
 */
export const getInternalUser = async (req, res, next) => {
  try {
    const { id } = req.params;

    const user = await prisma.user.findUnique({
      where: { id },
      // Security Check: Explicitly select fields to NEVER return the passwordHash
      select: {
        id: true,
        name: true,
        email: true,
        mobile: true,
        role: true,
      },
    });

    if (!user) {
      throw new NotFoundError("User not found");
    }

    res.status(200).json({ status: "success", data: user });
  } catch (error) {
    next(error);
  }
};

/**
 * 🚨 NEW: Provides a list of all Admins to the Notification Service for broadcast alerts
 * Called via /internal/admins
 */
export const getInternalAdmins = async (req, res, next) => {
  try {
    const admins = await prisma.user.findMany({
      where: { role: "ADMINISTRATOR" },
      select: {
        id: true,
        email: true,
        name: true,
        mobile: true,
      },
    });

    res.status(200).json({ status: "success", data: admins });
  } catch (error) {
    next(error);
  }
};
