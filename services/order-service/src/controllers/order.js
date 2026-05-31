import prisma from "../config/prisma.js";
import { publishEvent } from "@shop/event-bus";
import { NotFoundError, BadRequestError, logger } from "@shop/utils";
import { invalidatePattern, fetchCached } from "@shop/event-bus/src/redis.js";
import axios from "axios";
import crypto from "crypto";

// ==========================================
// HELPER: Generate 4-digit Secure PIN
// ==========================================
const generateDeliveryPin = () => {
  return crypto.randomInt(1000, 10000).toString();
};

// ==========================================
// HELPER: Generate 8-digit Order Id
// ==========================================
const generateOrderId = () => {
  // 1. Get current timestamp in milliseconds
  const timestamp = Date.now().toString();
  // 2. Generate random bytes to ensure uniqueness within the same millisecond
  const salt = crypto.randomBytes(4).toString("hex");
  // 3. Create a SHA-256 hash of the combined string
  const hash = crypto
    .createHash("sha256")
    .update(timestamp + salt)
    .digest("hex");
  // 4. Convert part of the hash to a number and take the last 8 digits
  // We parse a portion of the hex as an integer to get numeric digits
  const numericId = parseInt(hash.substring(0, 8), 16);
  // 5. Ensure it is exactly 8 digits by using modulo and padding
  return (numericId % 100000000).toString().padStart(8, "0");
};

// ==========================================
// 1. CUSTOMER: CREATE ORDER
// ==========================================

// export const createOrder = async (req, res, next) => {
//   try {
//     const { items, shippingAddress, paymentMethod, paymentType } = req.body;
//     const userId = req.user.id;
//     const userRole = req.user.role || "CUSTOMER";

//     // --- A. STRICT INPUT VALIDATION ---
//     if (!items || items.length === 0)
//       throw new BadRequestError("Order items cannot be empty");
//     if (!shippingAddress || !shippingAddress.city)
//       throw new BadRequestError(
//         "Shipping address with a valid city is required",
//       );

//     // Validate Payment Type securely
//     if (!["PREPAID", "POSTPAID"].includes(paymentType)) {
//       throw new BadRequestError(
//         "Invalid paymentType. Must be PREPAID or POSTPAID.",
//       );
//     }
//     if (!paymentMethod)
//       throw new BadRequestError("Payment method is required.");

//     const productServiceUrl =
//       process.env.PRODUCT_SERVICE_URL || "http://product-service:4003";

//     // --- B. SECURE PRICE & INVENTORY CALCULATION ---
//     const verifiedItems = await Promise.all(
//       items.map(async (item) => {
//         try {
//           const { data: response } = await axios.get(
//             `${productServiceUrl}/internal/${item.productId}`,
//             {
//               headers: { "x-internal-secret": process.env.INTERNAL_API_SECRET },
//             },
//           );

//           const product = response.data;
//           if (!product || product.status !== "ACTIVE") {
//             throw new BadRequestError(
//               `Product ${item.productName || item.productId} is no longer available.`,
//             );
//           }
//           if (product.inStock < item.quantity) {
//             throw new BadRequestError(
//               `Only ${product.inStock} left in stock for ${product.name}.`,
//             );
//           }

//           const actualPrice = product.discountedPrice
//             ? parseFloat(product.discountedPrice)
//             : parseFloat(product.price);
//           return {
//             productId: product.id,
//             productName: product.name,
//             quantity: item.quantity,
//             priceAtTime: actualPrice,
//           };
//         } catch (error) {
//           logger.error(
//             `[Order Validation] Failed for product ${item.productId}: ${error.message}`,
//           );
//           throw new BadRequestError(
//             error.response?.data?.message ||
//               `Failed to verify product: ${item.productName || item.productId}`,
//           );
//         }
//       }),
//     );

//     const itemsTotal = verifiedItems.reduce(
//       (sum, item) => sum + item.priceAtTime * item.quantity,
//       0,
//     );

//     // --- C. SECURE SHIPPING CALCULATION ---
//     let shippingCost = 0;
//     try {
//       const { data: shippingRes } = await axios.post(
//         `${productServiceUrl}/public/shipping/calculate`,
//         { city: shippingAddress.city, cartTotal: itemsTotal },
//       );
//       shippingCost = shippingRes.data.shippingCost;
//     } catch (error) {
//       logger.error(
//         `[Order Validation] Failed to calculate shipping: ${error.message}`,
//       );
//       throw new BadRequestError(
//         "Could not calculate shipping for the provided address.",
//       );
//     }

//     const finalTotalAmount = itemsTotal + shippingCost;
//     const deliveryAuthCode = generateDeliveryPin();
//     const orderId = generateOrderId();

//     // --- D. ATOMIC DATABASE SAVE ---
//     const order = await prisma.order.create({
//       data: {
//         userId,
//         orderId,
//         totalAmount: finalTotalAmount,
//         shippingCost,
//         shippingAddress,
//         paymentMethod,
//         paymentType,
//         deliveryAuthCode,
//         status: "PENDING",
//         items: {
//           create: verifiedItems.map((item) => ({
//             productId: item.productId,
//             productName: item.productName,
//             quantity: item.quantity,
//             priceAtTime: item.priceAtTime,
//           })),
//         },
//         history: {
//           create: {
//             action: "CREATED",
//             oldStatus: null,
//             newStatus: "PENDING",
//             userId,
//             userRole,
//             notes: `Order placed successfully. Selected: ${paymentType} via ${paymentMethod}.`,
//           },
//         },
//       },
//       include: { items: true },
//     });

//     // --- E. PUBLISH EVENT (Including paymentType) ---
//     await publishEvent("stream:orders", {
//       eventType: "OrderCreated",
//       orderId: order.orderId,
//       dbOrderId: order.id, // Internal DB ID
//       userId: order.userId,
//       paymentType: order.paymentType,
//       totalAmount: finalTotalAmount,
//       items: order.items.map((i) => ({
//         productId: i.productId,
//         quantity: i.quantity,
//       })),
//     });

//     res.status(201).json({
//       status: "success",
//       data: {
//         ...order,
//         summary: { itemsTotal, shippingCost, finalTotalAmount },
//       },
//     });
//   } catch (error) {
//     next(error);
//   }
// };

export const createOrder = async (req, res, next) => {
  try {
    const { items, shippingAddress, paymentMethod, paymentType } = req.body;
    const userId = req.user.id;
    const userRole = req.user.role || "CUSTOMER";

    // --- A. STRICT INPUT VALIDATION ---
    if (!items || items.length === 0)
      throw new BadRequestError("Order items cannot be empty");
    if (!shippingAddress || !shippingAddress.city)
      throw new BadRequestError(
        "Shipping address with a valid city is required",
      );
    if (!["PREPAID", "POSTPAID"].includes(paymentType)) {
      throw new BadRequestError(
        "Invalid paymentType. Must be PREPAID or POSTPAID.",
      );
    }
    if (!paymentMethod)
      throw new BadRequestError("Payment method is required.");

    const productServiceUrl =
      process.env.PRODUCT_SERVICE_URL || "http://product-service:4003";

    // --- B. SECURE PRICE & INVENTORY CALCULATION ---
    // (Your existing verification logic remains unchanged...)
    const verifiedItems = await Promise.all(
      items.map(async (item) => {
        try {
          const { data: response } = await axios.get(
            `${productServiceUrl}/internal/${item.productId}`,
            {
              headers: { "x-internal-secret": process.env.INTERNAL_API_SECRET },
            },
          );
          const product = response.data;
          if (!product || product.status !== "ACTIVE")
            throw new BadRequestError(
              `Product ${item.productName || item.productId} is no longer available.`,
            );
          if (product.inStock < item.quantity)
            throw new BadRequestError(
              `Only ${product.inStock} left in stock for ${product.name}.`,
            );

          const actualPrice = product.discountedPrice
            ? parseFloat(product.discountedPrice)
            : parseFloat(product.price);
          return {
            productId: product.id,
            productName: product.name,
            quantity: item.quantity,
            priceAtTime: actualPrice,
          };
        } catch (error) {
          logger.error(
            `[Order Validation] Failed for product ${item.productId}: ${error.message}`,
          );
          throw new BadRequestError(
            error.response?.data?.message ||
              `Failed to verify product: ${item.productName || item.productId}`,
          );
        }
      }),
    );

    const itemsTotal = verifiedItems.reduce(
      (sum, item) => sum + item.priceAtTime * item.quantity,
      0,
    );

    // --- C. SECURE SHIPPING CALCULATION ---
    let shippingCost = 0;
    try {
      const { data: shippingRes } = await axios.post(
        `${productServiceUrl}/public/shipping/calculate`,
        { city: shippingAddress.city, cartTotal: itemsTotal },
      );
      shippingCost = shippingRes.data.shippingCost;
    } catch (error) {
      logger.error(
        `[Order Validation] Failed to calculate shipping: ${error.message}`,
      );
      throw new BadRequestError(
        "Could not calculate shipping for the provided address.",
      );
    }

    const finalTotalAmount = itemsTotal + shippingCost;
    const deliveryAuthCode = generateDeliveryPin();
    const orderId = generateOrderId();

    // 🚨 LOGIC BRANCH: Determine initial status based on payment type
    // If it's Cash on Delivery, we consider the order CONFIRMED instantly.
    // If it's Prepaid, it's PENDING until Stripe confirms it.
    const initialStatus = paymentType === "POSTPAID" ? "CONFIRMED" : "PENDING";

    // --- D. ATOMIC DATABASE SAVE ---
    const order = await prisma.order.create({
      data: {
        userId,
        orderId,
        totalAmount: finalTotalAmount,
        shippingCost,
        shippingAddress,
        paymentMethod,
        paymentType,
        deliveryAuthCode,
        status: initialStatus,
        items: {
          create: verifiedItems.map((item) => ({
            productId: item.productId,
            productName: item.productName,
            quantity: item.quantity,
            priceAtTime: item.priceAtTime,
          })),
        },
        history: {
          create: {
            action: "CREATED",
            oldStatus: null,
            newStatus: initialStatus,
            userId,
            userRole,
            notes: `Order placed successfully. Selected: ${paymentType} via ${paymentMethod}.`,
          },
        },
      },
      include: { items: true },
    });

    // Invalidate the user's cached orders list so the new order shows up immediately

    await invalidatePattern(`orders:user:${userId}:*`);
    await invalidatePattern(`orders:admin:*`);

    // --- E. PUBLISH EVENTS ---

    // 1. Alert the rest of the system (Inventory, Payment) that an order exists
    await publishEvent("stream:orders", {
      eventType: "OrderCreated",
      orderId: order.orderId,
      dbOrderId: order.id,
      userId: order.userId,
      paymentType: order.paymentType,
      totalAmount: finalTotalAmount,
      items: order.items.map((i) => ({
        productId: i.productId,
        quantity: i.quantity,
      })),
    });

    // 2. 🚨 THE NEW MECHANISM: Trigger Notifications for POSTPAID orders immediately
    if (paymentType === "POSTPAID") {
      // Notify the Customer
      await publishEvent("stream:notifications", {
        eventType: "ORDER_PLACED",
        userId: order.userId,
        orderId: order.orderId,
      });

      // Notify ALL Administrators
      await publishEvent("stream:notifications", {
        eventType: "SYSTEM",
        targetRole: "ADMINISTRATOR", // The Notification Service will catch this
        title: "🛍️ New Cash on Delivery Order",
        message: `Order #${order.orderId} was just placed for ${finalTotalAmount} RUB.`,
        link: `/admin/orders/${order.id}`,
      });
    }

    res.status(201).json({
      status: "success",
      data: {
        ...order,
        summary: { itemsTotal, shippingCost, finalTotalAmount },
      },
    });
  } catch (error) {
    next(error);
  }
};

// ==========================================
// 2. CUSTOMER: GET MY ORDERS (WITH REDIS CACHE)
// ==========================================
export const getUserOrders = async (req, res, next) => {
  try {
    const userId = req.user.id;

    // We use a static identifier 'list' for the generic list, but this allows for future pagination (e.g., page_1)
    const orders = await fetchCached(
      `orders:user:${userId}`, // Resource prefix
      "list", // Specific ID/Suffix
      async () => {
        // Fallback DB Query if cache is missed
        return await prisma.order.findMany({
          where: { userId },
          include: {
            items: true,
            history: { orderBy: { createdAt: "desc" } }, // Ensures latest history is first
          },
          orderBy: { createdAt: "desc" },
        });
      },
      3600, // Cache TTL: 1 hour (Optional)
    );

    res.status(200).json({ status: "success", data: orders });
  } catch (error) {
    next(error);
  }
};

// export const getOrderById = async (req, res, next) => {
//   try {
//     const order = await prisma.order.findUnique({
//       where: { id: req.params.id, userId: req.user.id },
//       include: {
//         items: true,
//         history: { orderBy: { createdAt: "desc" } },
//       },
//     });

//     if (!order) throw new NotFoundError("Order not found");
//     res.status(200).json({ status: "success", data: order });
//   } catch (error) {
//     next(error);
//   }
// };
// ==========================================
// CUSTOMER: GET SINGLE ORDER
// ==========================================
export const getOrderById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Strict ownership check: only fetch if userId matches the token
    const order = await prisma.order.findUnique({
      where: { id, userId },
      include: {
        items: true,
        history: { orderBy: { createdAt: "desc" } },
      },
    });

    if (!order) {
      throw new NotFoundError("Order not found");
    }

    res.status(200).json({ status: "success", data: order });
  } catch (error) {
    next(error);
  }
};

// ==========================================
// ADMIN: GET SINGLE ORDER (WITH USER DATA)
// ==========================================
export const getOrderByIdForAdmin = async (req, res, next) => {
  try {
    const { id } = req.params;

    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        items: true,
        history: { orderBy: { createdAt: "desc" } },
      },
    });

    if (!order) {
      throw new NotFoundError("Order not found");
    } else {
      const userServiceUrl =
        process.env.USER_SERVICE_URL || "http://localhost:4002";
      const requestUrl = `${userServiceUrl}/internal/${order.userId}`;

      const { data: userRes } = await axios.get(requestUrl, {
        headers: { "x-internal-secret": process.env.INTERNAL_API_SECRET },
      });

      console.log(userRes.data);
      if (userRes && userRes.data) {
        const user = userRes.data;
        const customerData = {
          id: user.id,
          email: user.email,
          mobile: user.mobile,
          fullName: user.customerProfile?.fullName || "Имя не указано",
          profilePhoto: user.customerProfile?.profilePhoto || null,
        };

        res.status(200).json({
          status: "success",
          data: {
            ...order,
            customer: customerData,
          },
        });
      }
    }
  } catch (error) {
    next(error);
  }
};

// ==========================================
// 3. ADMIN: GET ALL ORDERS (PAGINATED & CACHED)
// ==========================================
// export const getAllOrdersAdmin = async (req, res, next) => {
//   try {
//     const page = Math.max(1, parseInt(req.query.page) || 1);
//     const limit = Math.max(1, parseInt(req.query.limit) || 10);
//     const skip = (page - 1) * limit;
//     const { status, search } = req.query;

//     // 🚨 1. Construct a highly specific cache suffix
//     // This ensures that different pages, filters, and searches don't overwrite each other in Redis
//     const cacheSuffix = `page_${page}:limit_${limit}:status_${status || "ALL"}:search_${search || "none"}`;

//     // 🚨 2. Fetch from Redis, or execute the DB query if it's a cache miss
//     const cachedResult = await fetchCached(
//       "orders:admin", // Resource Prefix
//       cacheSuffix, // Unique Suffix
//       async () => {
//         // Fallback Database Query
//         const where = {};
//         if (status && status !== "ALL") {
//           where.status = status;
//         }
//         if (search) {
//           where.OR = [
//             { id: { contains: search, mode: "insensitive" } },
//             { userId: { contains: search, mode: "insensitive" } },
//           ];
//         }

//         const [orders, total] = await Promise.all([
//           prisma.order.findMany({
//             where,
//             skip,
//             take: limit,
//             orderBy: { createdAt: "desc" },
//             include: {
//               items: true,
//               history: { orderBy: { createdAt: "desc" }, take: 1 },
//             },
//           }),
//           prisma.order.count({ where }),
//         ]);

//         // Return an object containing BOTH results to cache them together
//         return { orders, total };
//       },
//       300, // TTL: 5 minutes. Admin data changes fast, so a short TTL absorbs traffic spikes without showing terribly stale data.
//     );

//     // 3. Destructure the result (whether it came from Redis or DB)
//     const { orders, total } = cachedResult;

//     res.status(200).json({
//       success: true,
//       data: orders,
//       pagination: {
//         total,
//         page,
//         limit,
//         totalPages: Math.ceil(total / limit),
//       },
//     });
//   } catch (error) {
//     next(error);
//   }
// };

// ==========================================
// 3. ADMIN: GET ALL ORDERS (PAGINATED & CACHED)
// ==========================================
export const getAllOrdersAdmin = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.max(1, parseInt(req.query.limit) || 10);
    const skip = (page - 1) * limit;

    const { status, search, sortBy, sortOrder, startDate, endDate } = req.query;

    const cacheSuffix = `page_${page}:limit_${limit}:status_${status || "ALL"}:search_${search || "none"}:sort_${sortBy || "createdAt"}_${sortOrder || "desc"}:date_${startDate || "none"}_${endDate || "none"}`;

    const cachedResult = await fetchCached(
      "orders:admin",
      cacheSuffix,
      async () => {
        const where = {};

        // 1. Filter by Status
        if (status && status !== "ALL") {
          where.status = status;
        }

        // 2. 🚨 Filter strictly by Order ID
        if (search && search.trim() !== "") {
          const searchTerm = search.trim();

          where.OR = [
            // Matches the friendly 8-digit orderId (e.g. "45981234")
            { orderId: { contains: searchTerm, mode: "insensitive" } },
            // Matches the exact backend UUID if they paste the full system ID
            ...(searchTerm.length > 20 ? [{ id: searchTerm }] : []),
          ];
          // Notice: userId has been completely removed from the OR array.
        }

        // 3. Filter by Date Range
        if (startDate || endDate) {
          where.createdAt = {};
          if (startDate) {
            where.createdAt.gte = new Date(
              new Date(startDate).setHours(0, 0, 0, 0),
            );
          }
          if (endDate) {
            where.createdAt.lte = new Date(
              new Date(endDate).setHours(23, 59, 59, 999),
            );
          }
        }

        // 4. Sorting
        let orderBy = { createdAt: "desc" };
        const validSortFields = ["id", "createdAt", "totalAmount", "status"];
        if (sortBy && validSortFields.includes(sortBy)) {
          const order =
            sortOrder === "asc" || sortOrder === "desc" ? sortOrder : "desc";
          orderBy = { [sortBy]: order };
        }

        const [orders, total] = await Promise.all([
          prisma.order.findMany({
            where,
            skip,
            take: limit,
            orderBy,
            include: {
              items: true,
              history: { orderBy: { createdAt: "desc" }, take: 1 },
            },
          }),
          prisma.order.count({ where }),
        ]);

        return { orders, total };
      },
      300,
    );

    const { orders, total } = cachedResult;

    res.status(200).json({
      success: true,
      data: orders,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    next(error);
  }
};

// ==========================================
// 4. ADMIN: UPDATE ORDER STATUS
// ==========================================
export const updateOrderStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;
    const adminId = req.user.id;
    const adminRole = req.user.role || "ADMINISTRATOR";

    const order = await prisma.order.findUnique({ where: { id } });
    if (!order) throw new NotFoundError("Order not found");

    if (order.status === status) {
      throw new BadRequestError("Order is already in this status");
    }

    const updatedOrder = await prisma.order.update({
      where: { id },
      data: {
        status,
        history: {
          create: {
            action: "ADMIN_STATUS_UPDATE",
            oldStatus: order.status,
            newStatus: status,
            userId: adminId,
            userRole: adminRole,
            notes: notes || `Order status updated manually to ${status}.`,
          },
        },
      },
    });

    // When an admin updates an order status, invalidate the specific order AND the user's order list

    await invalidatePattern(`orders:user:${order.userId}:*`);
    await invalidatePattern(`order:detail:${id}`);
    await invalidatePattern(`orders:admin:*`);

    if (status === "SHIPPED") {
      await publishEvent("stream:notifications", {
        eventType: "ORDER_SHIPPED",
        userId: order.userId,
        orderId: order.id,
      });
    }

    if (status === "OUT_FOR_DELIVERY") {
      await publishEvent("stream:notifications", {
        eventType: "SYSTEM",
        type: "INFO",
        userId: order.userId,
        orderId: order.id,
        title: "🚚 Your order is arriving today!",
        message: `Please give this secure PIN to your courier to receive your package: ${order.deliveryAuthCode}`,
        link: `/orders/${order.id}`,
      });
    }

    res.status(200).json({ status: "success", data: updatedOrder });
  } catch (error) {
    next(error);
  }
};

// ==========================================
// 5. COURIER: VERIFY DELIVERY (WITH PIN)
// ==========================================
export const verifyCourierDelivery = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { deliveryAuthCode } = req.body;
    const courierId = req.user.id;
    const courierRole = req.user.role || "COURIER";

    if (!deliveryAuthCode) {
      throw new BadRequestError("Delivery authentication code is required.");
    }

    const order = await prisma.order.findUnique({ where: { id } });
    if (!order) throw new NotFoundError("Order not found");

    if (order.status !== "OUT_FOR_DELIVERY") {
      throw new BadRequestError(
        `Package cannot be delivered because it is currently in status: ${order.status}`,
      );
    }

    if (order.deliveryAuthCode !== deliveryAuthCode.toString()) {
      await prisma.orderHistory.create({
        data: {
          orderId: order.id,
          action: "FAILED_DELIVERY_ATTEMPT",
          oldStatus: order.status,
          newStatus: order.status,
          userId: courierId,
          userRole: courierRole,
          notes: "Courier provided an incorrect delivery PIN.",
        },
      });
      throw new BadRequestError("Invalid delivery PIN code provided.");
    }

    await prisma.order.update({
      where: { id },
      data: {
        status: "DELIVERED",
        history: {
          create: {
            action: "COURIER_DELIVERED",
            oldStatus: "OUT_FOR_DELIVERY",
            newStatus: "DELIVERED",
            userId: courierId,
            userRole: courierRole,
            notes:
              "Courier successfully verified customer PIN and handed over the package.",
          },
        },
      },
    });

    await publishEvent("stream:notifications", {
      eventType: "ORDER_DELIVERED",
      userId: order.userId,
      orderId: order.id,
    });

    res.status(200).json({
      success: true,
      message: "Order successfully verified and marked as delivered.",
    });
  } catch (error) {
    next(error);
  }
};

// ==========================================
// 6. INTERNAL: GET ORDER FOR NOTIFICATION SERVICE (PDF GENERATION)
// ==========================================
export const getInternalOrder = async (req, res, next) => {
  try {
    const { id } = req.params;

    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        items: true,
      },
    });

    if (!order) {
      throw new NotFoundError("Order not found");
    }

    res.status(200).json({ status: "success", data: order });
  } catch (error) {
    next(error);
  }
};

// ==========================================
// INTERNAL: GET USER ORDER STATS
// ==========================================
export const getInternalUserStats = async (req, res, next) => {
  try {
    const { userId } = req.params;

    // Count only orders that have been successfully delivered
    const deliveredCount = await prisma.order.count({
      where: {
        userId: userId,
        status: "DELIVERED",
      },
    });

    // You can also aggregate total spent here if needed in the future
    const totalSpentAggregation = await prisma.order.aggregate({
      _sum: { totalAmount: true },
      where: { userId: userId, status: "DELIVERED" },
    });

    res.status(200).json({
      status: "success",
      data: {
        totalDelivered: deliveredCount,
        totalSpent: totalSpentAggregation._sum.totalAmount || 0,
      },
    });
  } catch (error) {
    next(error);
  }
};
