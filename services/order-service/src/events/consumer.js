import { consumeEvents, publishEvent } from "@shop/event-bus";
import prisma from "../config/prisma.js";
import { logger } from "@shop/utils";

export const startOrderEventConsumers = async () => {
  // 1. Listen to Product Service Events (Inventory Handlers)
  consumeEvents(
    "stream:products",
    "order-service-group",
    async (payload, eventId) => {
      try {
        if (payload.eventType === "InventoryReserved") {
          logger.info(
            `[Event] Inventory reserved for Order: ${payload.orderId}. Checking payment type.`,
          );

          const order = await prisma.order.findUnique({
            where: { id: payload.orderId },
          });
          if (!order) return;

          // 🚨 PREPAID vs POSTPAID FLOW
          if (order.paymentType === "POSTPAID") {
            // Cash on Delivery: Confirm immediately
            await prisma.order.update({
              where: { id: payload.orderId },
              data: { status: "CONFIRMED" },
            });

            await publishEvent("stream:notifications", {
              eventType: "ORDER_PLACED",
              userId: order.userId,
              orderId: order.id,
            });
          } else {
            // Pre-Paid: Wait for Payment Service
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

  // 2. Listen to Payment Service Events (Only relevant for PREPAID orders)
  consumeEvents(
    "stream:payments",
    "order-service-group",
    async (payload, eventId) => {
      try {
        const order = await prisma.order.findUnique({
          where: { id: payload.orderId },
          include: { items: true },
        });

        if (!order) return;

        // --- PAYMENT SUCCESS ---
        if (payload.eventType === "PaymentSucceeded") {
          logger.info(
            `[Event] Payment success for Order: ${payload.orderId}. Confirming order.`,
          );

          // Inside consumer.js - PaymentSucceeded block
          await prisma.order.update({
            where: { id: payload.orderId },
            data: {
              status: "CONFIRMED",
              // 🚨 Log the system automated action
              history: {
                create: {
                  action: "PAYMENT_CONFIRMED",
                  oldStatus: order.status,
                  newStatus: "CONFIRMED",
                  userId: "SYSTEM_PAYMENT_SVC",
                  userRole: "SYSTEM",
                  notes:
                    "Automated payment confirmation received from payment gateway.",
                },
              },
            },
          });

          await publishEvent("stream:notifications", {
            eventType: "ORDER_PLACED",
            userId: order.userId,
            orderId: order.id,
          });
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
