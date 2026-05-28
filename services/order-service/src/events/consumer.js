import { consumeEvents, publishEvent } from "@shop/event-bus";
import prisma from "../config/prisma.js";
import { logger } from "@shop/utils";

// Helper function to send dual notifications
const sendOrderConfirmedNotifications = async (order, messageType) => {
  // 1. Notify the Customer
  await publishEvent("stream:notifications", {
    eventType: "SYSTEM",
    type: "SUCCESS",
    userId: order.userId,
    title: "🎉 Order Confirmed!",
    message: `Your order #${order.orderId} has been ${messageType}. We are preparing it now!`,
    link: `/profile/orders/${order.id}`,
  });

  // 2. Notify ALL Administrators (Using a special target flag handled by Notification Svc)
  await publishEvent("stream:notifications", {
    eventType: "SYSTEM",
    type: "INFO",
    target: "ADMINISTRATOR",
    title: "🛍️ New Order Received",
    message: `Order #${order.orderId} was just confirmed. Value: ${order.totalAmount} RUB`,
    link: `/admin/orders/${order.id}`,
  });
};

export const startOrderEventConsumers = async () => {
  // 1. Listen to Product Service Events
  consumeEvents(
    "stream:products",
    "order-service-group",
    async (payload, eventId) => {
      try {
        if (payload.eventType === "InventoryReserved") {
          const order = await prisma.order.findUnique({
            where: { id: payload.orderId },
          });
          if (!order) return;

          // 🚨 POSTPAID FLOW: Confirm immediately upon inventory reservation
          if (order.paymentType === "POSTPAID") {
            await prisma.order.update({
              where: { id: payload.orderId },
              data: { status: "CONFIRMED" },
            });

            // Dispatch Notifications
            await sendOrderConfirmedNotifications(
              order,
              "placed and confirmed for Cash on Delivery",
            );
          } else {
            // PREPAID FLOW: Wait for Payment
            await prisma.order.update({
              where: { id: payload.orderId },
              data: { status: "AWAITING_PAYMENT" },
            });
          }
        }

        if (payload.eventType === "OutOfStock") {
          logger.warn(
            `[Event] Out of stock for Order: ${payload.orderId}. Cancelling.`,
          );

          const updateResult = await prisma.order.updateMany({
            where: { id: payload.orderId, status: "PENDING" },
            data: {
              status: "CANCELLED",
              cancelReason: payload.reason || "Item out of stock",
            },
          });

          if (updateResult.count > 0) {
            const order = await prisma.order.findUnique({
              where: { id: payload.orderId },
            });
            if (order) {
              await publishEvent("stream:notifications", {
                eventType: "SYSTEM",
                userId: order.userId,
                type: "ALERT",
                title: "Order Cancelled ⚠️",
                message:
                  "We're sorry, but an item in your order just sold out. Your order has been cancelled.",
                orderId: order.id,
                link: `/orders/${order.id}`,
              });
            }
          }
        }
      } catch (error) {
        logger.error(
          `[Consumer Error] Failed processing Product event for ${payload.orderId}`,
          error,
        );
      }
    },
  );

  // 2. Listen to Payment Service Events (PREPAID ONLY)
  consumeEvents(
    "stream:payments",
    "order-service-group",
    async (payload, eventId) => {
      try {
        const order = await prisma.order.findUnique({
          where: { id: payload.orderId },
        });
        if (!order) return;

        if (payload.eventType === "PaymentSucceeded") {
          logger.info(
            `[Event] Payment success for Order: ${payload.orderId}. Confirming.`,
          );

          await prisma.order.update({
            where: { id: payload.orderId },
            data: {
              status: "CONFIRMED",
              history: {
                create: {
                  action: "PAYMENT_CONFIRMED",
                  oldStatus: order.status,
                  newStatus: "CONFIRMED",
                  userId: "SYSTEM_PAYMENT_SVC",
                  userRole: "SYSTEM",
                  notes:
                    "Automated payment confirmation received from Stripe gateway.",
                },
              },
            },
          });

          // Dispatch Notifications
          await sendOrderConfirmedNotifications(order, "paid successfully");
        }

        // --- PAYMENT FAILED ---
        if (payload.eventType === "PaymentFailed") {
          logger.error(
            `[Event] Payment failed for Order: ${payload.orderId}. Cancelling.`,
          );

          await prisma.order.update({
            where: { id: payload.orderId },
            data: {
              status: "CANCELLED",
              cancelReason: "Payment authorization failed",
            },
          });

          await publishEvent("stream:notifications", {
            eventType: "PAYMENT_FAILED",
            userId: order.userId,
            orderId: payload.orderId,
          });

          // Restore Product Inventory
          await publishEvent("stream:orders", {
            eventType: "OrderCancelled",
            orderId: order.id,
            items: order.items.map((i) => ({
              productId: i.productId,
              quantity: i.quantity,
            })),
          });
        }
      } catch (error) {
        logger.error(
          `[Consumer Error] Failed processing Payment event for ${payload.orderId}`,
          error,
        );
      }
    },
  );
};
