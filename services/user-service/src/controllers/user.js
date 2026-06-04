import prisma from "../config/prisma.js";
import { NotFoundError, BadRequestError } from "@shop/utils";
import { optimizeAndUpload } from "@shop/utils";
import { fetchCached, invalidatePattern } from "@shop/event-bus";
import bcrypt from "bcryptjs";
import axios from "axios";

// Import Firebase messaging to resolve the undefined error in registerDeviceToken
// Adjust this path if your firebase admin initialization is located elsewhere
import { messaging } from "../config/firebase.js";

// ==========================================
// CONFIGURATION
// ==========================================
// Unique namespace for this microservice to prevent Redis key collisions
const CACHE_PREFIX = "userSvc:list";

// ==========================================
// HELPER: SYNC CUSTOMER ORDER STATS
// ==========================================
export const syncCustomerOrderStats = async (userId) => {
  try {
    const orderServiceUrl =
      process.env.ORDER_SERVICE_URL || "http://localhost:4004";

    // 1. Fetch stats from Order Service
    const requestUrl = `${orderServiceUrl}/internal/users/${userId}/stats`;
    const { data: statsRes } = await axios.get(requestUrl, {
      headers: { "x-internal-secret": process.env.INTERNAL_API_SECRET },
    });

    const totalDelivered = statsRes.data?.totalDelivered || 0;

    // 2. Update the User's Customer Profile in the Database
    await prisma.customerProfile.updateMany({
      where: { userId: userId },
      data: { totalOrders: totalDelivered },
    });

    return totalDelivered;
  } catch (error) {
    console.error(
      `[Order Sync Error] Failed to sync stats for user ${userId}:`,
      error.message,
    );
    return null; // Fail gracefully so it doesn't crash the main request
  }
};

// ==========================================
// 1. PUBLIC / PROTECTED USER ROUTES
// ==========================================

// export const getProfile = async (req, res, next) => {
//   try {
//     const user = await prisma.user.findUnique({
//       where: { id: req.user.id },
//       // Use nested include to traverse User -> CustomerProfile -> Addresses
//       include: {
//         customerProfile: {
//           include: {
//             addresses: true,
//           },
//         },
//       },
//     });

//     if (!user) throw new NotFoundError("User not found");

//     // Remove sensitive data
//     user.passwordHash = undefined;

//     // Flatten the response so the frontend can read `data.addresses` directly
//     // safely defaulting to an empty array if the profile or addresses don't exist yet
//     const userAddresses = user.customerProfile?.addresses || [];

//     // Attach addresses to the root of the user object
//     user.addresses = userAddresses;

//     res.status(200).json({ status: "success", data: user });
//   } catch (error) {
//     next(error);
//   }
// };

export const getProfile = async (req, res, next) => {
  try {
    const userId = req.user.id;

    syncCustomerOrderStats(userId);
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

    //     // Remove sensitive data
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
// GET USER BY ID (Basic Info for Chat/UI)
// ==========================================
export const getUserById = async (req, res, next) => {
  try {
    const { id } = req.params;

    const user = await prisma.user.findUnique({
      where: { id },
      include: {
        customerProfile: { select: { fullName: true, profilePhoto: true } },
        administratorProfile: {
          select: { fullName: true, profilePhoto: true },
        },
        supportProfile: { select: { fullName: true, profilePhoto: true } },
        courierProfile: { select: { fullName: true, profilePhoto: true } },
      },
    });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Safely extract the name depending on the user's role/profile
    const name =
      user.customerProfile?.fullName ||
      user.administratorProfile?.fullName ||
      user.supportProfile?.fullName ||
      user.courierProfile?.fullName ||
      "Пользователь";

    const image =
      user.customerProfile?.profilePhoto ||
      user.administratorProfile?.profilePhoto ||
      user.supportProfile?.profilePhoto ||
      user.courierProfile?.profilePhoto ||
      null;

    // Returns exactly what the frontend expects: { name: "..." }
    res.status(200).json({ name, image, role: user.role });
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
 * 🚨 Provides safe user data to other microservices (e.g. Notification Service)
 * Called via /internal/:id
 */
// export const getInternalUser = async (req, res, next) => {
//   try {
//     const { id } = req.params;

//     const user = await prisma.user.findUnique({
//       where: { id },
//       select: {
//         id: true,
//         email: true,
//         mobile: true,
//         customerProfile: {
//           select: {
//             fullName: true,
//             profilePhoto: true,
//           },
//         },
//       },
//     });

//     // This will now correctly trigger if the user is null
//     if (!user) {
//       throw new NotFoundError("User not found");
//     }

//     res.status(200).json({ status: "success", data: user });
//   } catch (error) {
//     next(error);
//   }
// };

export const getInternalUser = async (req, res, next) => {
  try {
    const { id } = req.params;

    const dbQuery = async () => {
      const user = await prisma.user.findUnique({
        where: { id },
        select: {
          id: true,
          email: true,
          mobile: true,
          role: true,
          updatedAt: true,
          customerProfile: {
            select: {
              fullName: true,
              profilePhoto: true,
            },
          },
          administratorProfile: {
            select: {
              fullName: true,
              profilePhoto: true,
            },
          },
        },
      });

      if (!user) {
        throw new NotFoundError("User not found");
      }

      return user;
    };

    const userProfile = await fetchCached(
      CACHE_PREFIX,
      "internal_user",
      dbQuery,
      86400,
    );

    res.status(200).json({ status: "success", data: userProfile });
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

export const updateProfileImage = async (req, res, next) => {
  try {
    const { id } = req.params; // This is the user ID from the URL

    // Ensure the authenticated user is only updating their own profile
    if (req.user.id !== id) {
      return res.status(403).json({
        status: "error",
        message:
          "Forbidden: You do not have permission to update this profile image",
      });
    }

    if (!req.file) {
      throw new BadRequestError("No file uploaded");
    }

    // 1. Upload and Optimize the image

    const fileUrl = await optimizeAndUpload(
      req.file,
      `profile/${id}`, // baseFolder
      "profileImage", // dynamicId
      1200,
    );

    // 2. Update the CustomerProfile (or AdministratorProfile based on role)
    let updatedProfile;
    if (req.user.role === "ADMINISTRATOR") {
      updatedProfile = await prisma.administratorProfile.update({
        where: { userId: id },
        data: { profilePhoto: fileUrl },
      });
    } else {
      updatedProfile = await prisma.customerProfile.update({
        where: { userId: id },
        data: { profilePhoto: fileUrl },
      });
    }

    res.status(200).json({
      status: "success",
      data: { profilePhoto: updatedProfile.profilePhoto },
    });
  } catch (error) {
    next(error);
  }
};

export const updateProfileDetails = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { fullName, email } = req.body;

    if (req.user.id !== id) {
      return res.status(403).json({
        status: "error",
        message: "Forbidden: You do not have permission to update this profile",
      });
    }

    // Update the core User table (for email)
    if (email) {
      await prisma.user.update({
        where: { id },
        data: { email },
      });
    }

    // Update the linked Profile table (for fullName)
    let updatedProfile;
    if (req.user.role === "ADMINISTRATOR") {
      updatedProfile = await prisma.administratorProfile.update({
        where: { userId: id },
        data: { ...(fullName && { fullName }) },
      });
    } else {
      updatedProfile = await prisma.customerProfile.update({
        where: { userId: id },
        data: { ...(fullName && { fullName }) },
      });
    }

    res.status(200).json({
      status: "success",
      message: "Profile updated successfully",
    });
  } catch (error) {
    next(error);
  }
};

export const getNonCustomersList = async (req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      where: {
        role: { in: ["ADMINISTRATOR", "SUPPORT", "COURIER"] },
      },
      include: {
        customerProfile: { select: { fullName: true, profilePhoto: true } },
        administratorProfile: {
          select: { fullName: true, profilePhoto: true },
        },
        courierProfile: { select: { fullName: true, profilePhoto: true } },
        supportProfile: { select: { fullName: true, profilePhoto: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    const formattedUsers = users.map((user) => ({
      id: user.id,
      mobile: user.mobile,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
      status: user.status,
      name:
        user.administratorProfile?.fullName ||
        user.supportProfile?.fullName ||
        user.courierProfile?.fullName ||
        user.customerProfile?.fullName ||
        "Без имени",
      profilePhoto:
        user.administratorProfile?.profilePhoto ||
        user.supportProfile?.profilePhoto ||
        user.courierProfile?.profilePhoto ||
        user.customerProfile?.profilePhoto ||
        null,
    }));

    res.status(200).json(formattedUsers);
  } catch (error) {
    console.error("Fetch users error:", error);
    next(error);
  }
};

export const getAdminList = async (req, res, next) => {
  try {
    const dbQuery = async () => {
      const users = await prisma.user.findMany({
        where: {
          role: "ADMINISTRATOR",
        },
        include: {
          administratorProfile: {
            select: { fullName: true, profilePhoto: true },
          },
        },
        orderBy: { createdAt: "desc" },
      });

      console.log(users[0]);

      const formattedUsers = users.map((user) => ({
        id: user.id,
        mobile: user.mobile,
        email: user.email,
        role: user.role,
        createdAt: user.createdAt,
        status: user.status,
        name: user.administratorProfile?.fullName || "Без имени",
        profilePhoto: user.administratorProfile?.profilePhoto || null,
      }));

      return formattedUsers;
    };

    const formattedUsers = await fetchCached(
      CACHE_PREFIX,
      "admins",
      dbQuery,
      86400,
    );

    res.status(200).json(formattedUsers);
  } catch (error) {
    console.error("Fetch users error:", error);
    next(error);
  }
};

export const createUser = async (req, res, next) => {
  try {
    const { email, password, mobile, name, role, status } = req.body;

    // 🚨 FIX: Email is no longer required. Mobile is the core identifier.
    if (!mobile || !password || !role || !name) {
      return res.status(400).json({
        message: "Missing required fields (Name, Mobile, Password, Role)",
      });
    }

    // 🚨 Check Mobile Uniqueness
    const existingUser = await prisma.user.findUnique({ where: { mobile } });
    if (existingUser) {
      return res.status(400).json({
        message: "Пользователь с таким номером телефона уже существует",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const profilePhoto =
      "https://res.cloudinary.com/dlywo5mxn/image/upload/v1689572976/afed80130a2682f1a428984ed8c84308_wscf7t.jpg";

    let data = {
      email: email && email.trim() !== "" ? email : null, // Store as null if empty
      password: hashedPassword,
      mobile,
      role,
      status: status || "ACTIVE",
    };

    if (role === "ADMINISTRATOR") {
      data.administratorProfile = { create: { fullName: name, profilePhoto } };
    } else if (role === "COURIER") {
      data.courierProfile = { create: { fullName: name, profilePhoto } };
    } else if (role === "SUPPORT") {
      data.supportProfile = { create: { fullName: name, profilePhoto } };
    }

    await prisma.user.create({ data });
    res.status(201).json({ message: "User created successfully" });
  } catch (error) {
    console.error("Create User Error:", error);
    next(error);
  }
};

export const updateUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, role, password, status, mobile, email } = req.body;

    if (!mobile || !role || !name) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    // 🚨 Prevent updating to a mobile number that is already taken by someone else
    const existingUser = await prisma.user.findUnique({ where: { mobile } });
    if (existingUser && existingUser.id !== id) {
      return res.status(400).json({
        message: "Этот номер телефона уже используется другим пользователем",
      });
    }

    const dataToUpdate = {
      role,
      mobile,
      status,
      email: email && email.trim() !== "" ? email : null, // Clean up optional email
    };

    if (password && password.trim() !== "") {
      dataToUpdate.password = await bcrypt.hash(password, 10);
    }

    if (role === "ADMINISTRATOR") {
      dataToUpdate.administratorProfile = {
        upsert: {
          create: { fullName: name, profilePhoto: "" },
          update: { fullName: name },
        },
      };
    } else if (role === "COURIER") {
      dataToUpdate.courierProfile = {
        upsert: {
          create: { fullName: name, profilePhoto: "" },
          update: { fullName: name },
        },
      };
    } else if (role === "SUPPORT") {
      dataToUpdate.supportProfile = {
        upsert: {
          create: { fullName: name, profilePhoto: "" },
          update: { fullName: name },
        },
      };
    }

    await prisma.user.update({
      where: { id },
      data: dataToUpdate,
    });

    res.status(200).json({ message: "User updated successfully" });
  } catch (error) {
    console.error("Update user error:", error);
    next(error);
  }
};

export const deleteUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (req.user.id === id) {
      return res
        .status(400)
        .json({ message: "Cannot delete your own account" });
    }
    await prisma.user.delete({ where: { id } });
    res.status(200).json({ message: "User deleted successfully" });
  } catch (error) {
    console.error("Delete user error:", error);
    next(error);
  }
};
