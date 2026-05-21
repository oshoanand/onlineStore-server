import prisma from "../config/prisma.js";
import { publishEvent } from "@shop/event-bus";
import { NotFoundError, BadRequestError, logger } from "@shop/utils";
import axios from "axios";
import crypto from "crypto";

// ==========================================
// HELPER: Generate 4-digit Secure PIN
// ==========================================
const generateDeliveryPin = () => {
  // Generates a random number between 1000 and 9999
  return crypto.randomInt(1000, 10000).toString();
};

// ==========================================
// 1. CUSTOMER: CREATE ORDER
// ==========================================
export const createOrder = async (req, res, next) => {
  try {
    const { items, shippingAddress, paymentMode, paymentType } = req.body;
    const userId = req.user.id;
    const userRole = req.user.role || "CUSTOMER";

    if (!items || items.length === 0) {
      throw new BadRequestError("Order items cannot be empty");
    }
    if (!shippingAddress || !shippingAddress.city) {
      throw new BadRequestError(
        "Shipping address with a valid city is required",
      );
    }
    if (!paymentMode || !paymentType) {
      throw new BadRequestError("Payment mode and payment type are required");
    }

    const productServiceUrl =
      process.env.PRODUCT_SERVICE_URL || "http://product-service:4003";

    let itemsTotal = 0;
    const verifiedItems = [];

    // --- A. SECURE PRICE & INVENTORY CALCULATION ---
    await Promise.all(
      items.map(async (item) => {
        try {
          const { data: response } = await axios.get(
            `${productServiceUrl}/products/admin/${item.productId}`,
            {
              headers: { "x-internal-secret": process.env.INTERNAL_API_SECRET },
            },
          );

          const product = response.data;

          if (!product || product.status !== "ACTIVE") {
            throw new BadRequestError(
              `Product ${item.productName || item.productId} is no longer available.`,
            );
          }

          if (product.inStock < item.quantity) {
            throw new BadRequestError(
              `Only ${product.inStock} left in stock for ${product.name}.`,
            );
          }

          const actualPrice = product.discountedPrice
            ? parseFloat(product.discountedPrice)
            : parseFloat(product.price);

          itemsTotal += actualPrice * item.quantity;

          verifiedItems.push({
            productId: product.id,
            productName: product.name,
            quantity: item.quantity,
            priceAtTime: actualPrice,
          });
        } catch (error) {
          logger.error(
            `[Order Validation] Failed for product ${item.productId}: ${error.message}`,
          );
          throw new BadRequestError(
            error.response?.data?.message ||
              `Failed to verify product: ${item.productName}`,
          );
        }
      }),
    );

    // --- B. SECURE SHIPPING CALCULATION ---
    let shippingCost = 0;
    try {
      const { data: shippingRes } = await axios.post(
        `${productServiceUrl}/products/shipping/public/calculate`,
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

    // --- C. SAVE ORDER & HISTORY TO DATABASE ---
    const order = await prisma.order.create({
      data: {
        userId,
        totalAmount: finalTotalAmount,
        shippingCost: shippingCost,
        shippingAddress,
        paymentMode,
        paymentType,
        deliveryAuthCode,
        status: "PENDING",
        items: {
          create: verifiedItems.map((item) => ({
            productId: item.productId,
            productName: item.productName,
            quantity: item.quantity,
            priceAtTime: item.priceAtTime,
          })),
        },
        // Log the creation immutably
        history: {
          create: {
            action: "CREATED",
            oldStatus: null,
            newStatus: "PENDING",
            userId,
            userRole,
            notes: `Order placed successfully using ${paymentMode} (${paymentType}).`,
          },
        },
      },
      include: { items: true },
    });

    // --- D. PUBLISH EVENT TO RESERVE INVENTORY ---
    await publishEvent("stream:orders", {
      eventType: "OrderCreated",
      orderId: order.id,
      userId: order.userId,
      totalAmount: finalTotalAmount,
      items: order.items.map((i) => ({
        productId: i.productId,
        quantity: i.quantity,
      })),
    });

    logger.info(
      `[Order] Created successfully. ID: ${order.id} | Total: ${finalTotalAmount}`,
    );

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
// 2. CUSTOMER: GET MY ORDERS
// ==========================================
export const getUserOrders = async (req, res, next) => {
  try {
    const orders = await prisma.order.findMany({
      where: { userId: req.user.id },
      include: {
        items: true,
        history: { orderBy: { createdAt: "desc" } },
      },
      orderBy: { createdAt: "desc" },
    });
    res.status(200).json({ status: "success", data: orders });
  } catch (error) {
    next(error);
  }
};

export const getOrderById = async (req, res, next) => {
  try {
    const order = await prisma.order.findUnique({
      where: { id: req.params.id, userId: req.user.id },
      include: {
        items: true,
        history: { orderBy: { createdAt: "desc" } },
      },
    });

    if (!order) throw new NotFoundError("Order not found");
    res.status(200).json({ status: "success", data: order });
  } catch (error) {
    next(error);
  }
};

// ==========================================
// 3. ADMIN: GET ALL ORDERS (PAGINATED)
// ==========================================
export const getAllOrdersAdmin = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.max(1, parseInt(req.query.limit) || 10);
    const skip = (page - 1) * limit;
    const { status, search } = req.query;

    const where = {};
    if (status && status !== "ALL") {
      where.status = status;
    }
    if (search) {
      where.OR = [
        { id: { contains: search, mode: "insensitive" } },
        { userId: { contains: search, mode: "insensitive" } },
      ];
    }

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          items: true,
          // Pulling the latest history log for the admin dashboard overview
          history: { orderBy: { createdAt: "desc" }, take: 1 },
        },
      }),
      prisma.order.count({ where }),
    ]);

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
    const adminRole = req.user.role || "ADMIN";

    const order = await prisma.order.findUnique({ where: { id } });
    if (!order) throw new NotFoundError("Order not found");

    // Prevent duplicate status updates and spamming the history log
    if (order.status === status) {
      throw new BadRequestError("Order is already in this status");
    }

    const updatedOrder = await prisma.order.update({
      where: { id },
      data: {
        status,
        // Log the admin action
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

    // --- EVENT ROUTING ---
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

    // --- SECURITY: INVALID PIN CHECK ---
    if (order.deliveryAuthCode !== deliveryAuthCode.toString()) {
      // Log the failed attempt to prevent internal fraud
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

    // --- SECURITY: SUCCESSFUL VERIFICATION ---
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

    // Notify Customer
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
