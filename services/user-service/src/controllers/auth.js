import prisma from "../config/prisma.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { publishEvent } from "@shop/event-bus";
import { UnauthorizedError, logger } from "@shop/utils";
import "dotenv/config";

const generateToken = (user) => {
  return jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN,
    algorithm: "HS256",
  });
};

export const register = async (req, res, next) => {
  try {
    const { mobile, email, password, name, fcmToken } = req.body;
    let existingUser = await prisma.user.findUnique({ where: { mobile } });

    if (existingUser) {
      return res.status(403).json({
        success: false,
        message: "Mobile Number is already registered!",
      });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // 1. Create User AND CustomerProfile safely in a single Prisma transaction
    const user = await prisma.user.create({
      data: {
        email: email,
        mobile: mobile,
        password: passwordHash,
        fcmTokens: fcmToken ? [fcmToken] : [], // Use the new string array
        role: "CUSTOMER",
        customerProfile: {
          create: {
            fullName: name,
            profilePhoto:
              "https://res.cloudinary.com/dlywo5mxn/image/upload/v1689572976/afed80130a2682f1a428984ed8c84308_wscf7t.jpg",
          },
        },
      },
      include: { customerProfile: true }, // Include it so we can return it below
    });

    // 2. Generate JWT
    const token = generateToken(user);

    // 3. Publish Event
    await publishEvent("stream:users", {
      eventType: "USER_REGISTERED",
      data: {
        userId: user.id,
        email: user.email,
        name: user.customerProfile.fullName,
        mobile: user.mobile,
      },
    });

    logger.info(`[Auth] New user registered: ${mobile}`);

    return res.status(200).json({
      success: true,
      message: "Registration successful",
      data: {
        id: user.id,
        name: user.customerProfile.fullName,
        email: user.email,
        image: user.customerProfile.profilePhoto,
        mobile: user.mobile,
        role: user.role,
        token: token,
      },
    });
  } catch (error) {
    next(error); // Pass to the global error handler instead of simple console.log
  }
};

export const login = async (req, res, next) => {
  try {
    const { mobile, password, userType, fcmToken } = req.body;

    // 1. Find user strictly by Mobile number first to check their actual DB role
    const user = await prisma.user.findUnique({
      where: { mobile: mobile },
      include: {
        customerProfile: true,
        administratorProfile: true,
      },
    });

    // 2. Status and Existence Check
    if (!user || user.status !== "ACTIVE") {
      throw new UnauthorizedError(
        "Invalid credentials or account is inactive.",
      );
    }

    // 3. Verify Password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      throw new UnauthorizedError("Invalid credentials.");
    }

    // ==========================================
    // 4. 🚨 STRICT ROLE & PORTAL SECURITY CHECK
    // ==========================================

    // If the frontend login request is originating from the Admin Panel
    if (userType === "ADMINISTRATOR" || userType === "SUPPORT") {
      // Check if their actual database role grants them admin panel access
      if (user.role !== "ADMINISTRATOR" && user.role !== "SUPPORT") {
        logger.warn(
          `[SECURITY ALERT] Customer ${mobile} attempted to access the Admin Panel.`,
        );

        // 403 Forbidden: Authenticated successfully, but NOT authorized for this action
        return res.status(403).json({
          success: false,
          message:
            "Access Denied: You do not have administrator privileges to access this panel.",
        });
      }
    }
    // If the frontend login request is originating from the Customer App
    else if (userType === "CUSTOMER") {
      if (user.role !== "CUSTOMER") {
        return res.status(403).json({
          success: false,
          message:
            "Access Denied: Staff members must use the Admin Portal to log in.",
        });
      }
    }

    // ==========================================
    // 5. UPDATE SESSION DATA
    // ==========================================

    // Append new FCM Token if they logged in from a new device
    if (fcmToken && !user.fcmTokens.includes(fcmToken)) {
      await prisma.user.update({
        where: { id: user.id },
        data: { fcmTokens: { push: fcmToken } },
      });
    }

    // Extract the correct profile based on their actual role
    // Support staff and Administrators both use the administratorProfile table
    const profile =
      user.role === "ADMINISTRATOR" || user.role === "SUPPORT"
        ? user.administratorProfile
        : user.customerProfile;

    // Generate JWT
    const token = generateToken(user);

    logger.info(`[Auth] ${user.role} logged in successfully: ${mobile}`);

    return res.status(200).json({
      success: true,
      message: "Login successful",
      data: {
        id: user.id,
        name: profile?.fullName || "System User",
        email: user.email,
        image: profile?.profilePhoto || null,
        mobile: user.mobile,
        role: user.role,
        token: token,
      },
    });
  } catch (error) {
    next(error);
  }
};
