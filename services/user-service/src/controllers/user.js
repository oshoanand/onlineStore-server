import prisma from "../config/prisma.js";
import { NotFoundError, BadRequestError } from "@shop/utils";

// Import Firebase messaging to resolve the undefined error in registerDeviceToken
// Adjust this path if your firebase admin initialization is located elsewhere
import { messaging } from "../config/firebase.js";

// ==========================================
// 1. PUBLIC / PROTECTED USER ROUTES
// ==========================================

export const getProfile = async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      // Use nested include to traverse User -> CustomerProfile -> Addresses
      include: {
        customerProfile: {
          include: {
            addresses: true,
          },
        },
      },
    });

    if (!user) throw new NotFoundError("User not found");

    // Remove sensitive data
    user.passwordHash = undefined;

    // Flatten the response so the frontend can read `data.addresses` directly
    // safely defaulting to an empty array if the profile or addresses don't exist yet
    const userAddresses = user.customerProfile?.addresses || [];

    // Attach addresses to the root of the user object
    user.addresses = userAddresses;

    res.status(200).json({ status: "success", data: user });
  } catch (error) {
    next(error);
  }
};

// ==========================================
// ADD ADDRESS
// ==========================================

export const addAddress = async (req, res, next) => {
  try {
    // 1. Extract the correct fields based on your schema
    const { street, city, state, pincode, tag, isDefault } = req.body;

    // NOTE: If req.user.id is the User ID, you must fetch the CustomerProfile first.
    // Assuming you have a 1:1 relation, it looks like this:
    const profile = await prisma.customerProfile.findUnique({
      where: { userId: req.user.id },
    });

    if (!profile) {
      return res.status(404).json({ message: "Customer profile not found" });
    }

    const customerProfileId = profile.id;

    // 2. Unset previous defaults using the correct relational ID
    if (isDefault) {
      await prisma.address.updateMany({
        where: { customerProfileId: customerProfileId, isDefault: true },
        data: { isDefault: false },
      });
    }

    // 3. Create the address mapping to the exact Prisma schema fields
    const address = await prisma.address.create({
      data: {
        customerProfileId: customerProfileId,
        street,
        city,
        state,
        pincode, // Replaced zipCode with pincode
        tag, // Added optional tag field
        isDefault: isDefault || false,
      },
    });

    res.status(201).json({ status: "success", data: address });
  } catch (error) {
    next(error);
  }
};

// ==========================================
// UPDATE ADDRESS
// ==========================================
export const updateAddress = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { street, city, state, pincode, tag, isDefault } = req.body;

    // 1. Find the user's CustomerProfile
    const profile = await prisma.customerProfile.findUnique({
      where: { userId: req.user.id },
    });

    if (!profile) {
      throw new NotFoundError("Customer profile not found");
    }

    // 2. Verify ownership (Security Check)
    const existingAddress = await prisma.address.findUnique({
      where: { id },
    });

    if (!existingAddress) {
      throw new NotFoundError("Address not found");
    }

    if (existingAddress.customerProfileId !== profile.id) {
      return res.status(403).json({
        status: "error",
        message: "Forbidden: You do not have permission to edit this address",
      });
    }

    // 3. Handle 'isDefault' toggle logic
    if (isDefault) {
      // Unset any other default addresses for this profile
      await prisma.address.updateMany({
        where: {
          customerProfileId: profile.id,
          isDefault: true,
          id: { not: id }, // Exclude the current address being updated
        },
        data: { isDefault: false },
      });
    }

    // 4. Update the address
    const updatedAddress = await prisma.address.update({
      where: { id },
      data: {
        ...(street && { street }),
        ...(city && { city }),
        ...(state && { state }),
        ...(pincode !== undefined && { pincode }),
        ...(tag !== undefined && { tag }),
        ...(isDefault !== undefined && { isDefault }),
      },
    });

    res.status(200).json({ status: "success", data: updatedAddress });
  } catch (error) {
    next(error);
  }
};

// ==========================================
// DELETE ADDRESS
// ==========================================
export const deleteAddress = async (req, res, next) => {
  try {
    const { id } = req.params;

    // 1. Find the user's CustomerProfile
    const profile = await prisma.customerProfile.findUnique({
      where: { userId: req.user.id },
    });

    if (!profile) {
      throw new NotFoundError("Customer profile not found");
    }

    // 2. Verify ownership (Security Check)
    const existingAddress = await prisma.address.findUnique({
      where: { id },
    });

    if (!existingAddress) {
      throw new NotFoundError("Address not found");
    }

    if (existingAddress.customerProfileId !== profile.id) {
      return res.status(403).json({
        status: "error",
        message: "Forbidden: You do not have permission to delete this address",
      });
    }

    // 3. Delete the address
    await prisma.address.delete({
      where: { id },
    });

    res.status(200).json({
      status: "success",
      message: "Address deleted successfully",
    });
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

    // 1. Fetch the user's current tokens first
    const user = await prisma.user.findUnique({
      where: { mobile: mobile },
    });

    const existingTokens = user?.fcmTokens || [];

    // 2. Append the new token only if it doesn't already exist in the array
    const updatedUser = await prisma.user.update({
      where: { mobile: mobile },
      data: {
        fcmTokens: existingTokens.includes(token)
          ? existingTokens
          : [...existingTokens, token],
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

    const user = await prisma.user.findMany({
      where: { id },
      select: {
        id: true,
        email: true,
        mobile: true,
        customerProfile: {
          select: {
            fullName: true,
          },
        },
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
      where: {
        role: "ADMINISTRATOR",
      },
      select: {
        id: true,
        email: true,
        mobile: true,
        administratorProfile: {
          select: {
            fullName: true,
          },
        },
      },
    });
    res.status(200).json({ status: "success", data: admins });
  } catch (error) {
    next(error);
  }
};
