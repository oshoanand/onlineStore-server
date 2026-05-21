import { consumeEvents } from "@shop/event-bus";
import prisma from "../config/prisma.js";
import { logger } from "@shop/utils";

export const startPaymentEventConsumers = async () => {
  await consumeEvents(
    "stream:orders",
    "payment-service-group",
    async (payload, eventId) => {
      try {
        if (payload.eventType === "OrderCreated") {
          logger.info(
            `[Event] Creating pending payment for Order: ${payload.orderId}`,
          );

          const amount = payload.totalAmount || payload.data?.totalAmount;

          if (!amount) {
            throw new Error(
              `OrderCreated event for ${payload.orderId} is missing totalAmount.`,
            );
          }

          // Idempotent creation (in case the event is read twice by the consumer group)
          await prisma.paymentTransaction.upsert({
            where: { orderId: payload.orderId },
            update: {}, // Do nothing if it already exists
            create: {
              orderId: payload.orderId,
              userId: payload.userId,
              amount: parseFloat(amount),
              currency: "rub", // CRITICAL: Set your default store currency here
              status: "PENDING",
            },
          });
        }

        // If the Product Service says "Out of Stock", the Order Service cancels the order.
        // We must cancel the pending payment intent here so the user cannot pay for an invalid order.
        if (payload.eventType === "OrderCancelled") {
          logger.warn(
            `[Event] Cancelling payment for Order: ${payload.orderId}`,
          );

          await prisma.paymentTransaction.updateMany({
            where: { orderId: payload.orderId, status: "PENDING" },
            data: { status: "CANCELLED" },
          });
        }
      } catch (error) {
        logger.error(
          `[Consumer Error] Failed processing event for ${payload.orderId}: ${error.message}`,
          error,
        );
      }
    },
  );
};
