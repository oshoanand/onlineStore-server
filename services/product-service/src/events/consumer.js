import {
  consumeEvents,
  publishEvent,
  invalidatePattern,
} from "@shop/event-bus";
import { logger } from "@shop/utils";
import prisma from "../config/prisma.js";

// Ensure this exactly matches the prefix used in product controllers
const CACHE_PREFIX = "productSvc:products";

export const startProductEventConsumer = async () => {
  // Listen to the 'orders' stream
  await consumeEvents(
    "stream:orders",
    "product-service-group",
    async (payload, eventId) => {
      if (payload.eventType === "OrderCreated") {
        logger.info(
          `[Event] Processing OrderCreated for Order ID: ${payload.orderId}`,
        );

        // 1. Array to track items that just hit zero inventory
        const newlyOutOfStock = [];

        try {
          // 2. SAFE INVENTORY DEDUCTION (Prevents Negative Stock)
          await prisma.$transaction(async (tx) => {
            for (const item of payload.items) {
              const product = await tx.product.findUnique({
                where: { id: item.productId },
                select: { inStock: true, name: true, status: true },
              });

              if (!product) {
                throw new Error(`Product ${item.productId} not found.`);
              }

              if (product.status !== "ACTIVE") {
                throw new Error(
                  `Product ${product.name} is currently unavailable.`,
                );
              }

              if (product.inStock < item.quantity) {
                throw new Error(
                  `Insufficient stock for ${product.name}. Available: ${product.inStock}, Requested: ${item.quantity}`,
                );
              }

              // Check if this exact deduction brings the stock to 0
              const isNowOutOfStock = product.inStock - item.quantity === 0;

              // Safely decrement now that we verified the quantity
              await tx.product.update({
                where: { id: item.productId },
                data: {
                  inStock: { decrement: item.quantity },
                  // Automatically mark Out Of Stock if it hits 0
                  ...(isNowOutOfStock && {
                    status: "OUT_OF_STOCK",
                  }),
                },
              });

              // If it went out of stock, queue it for notification
              if (isNowOutOfStock) {
                newlyOutOfStock.push({
                  id: item.productId,
                  name: product.name,
                });
              }
            }
          });

          // 3. 🚨 INVALIDATE CACHE: Inventory changed, so storefront caches are stale
          await invalidatePattern(`${CACHE_PREFIX}:*`);

          // 4. Publish success event for the Order Service to finalize checkout (Charge payment)
          await publishEvent("stream:products", {
            eventType: "InventoryReserved",
            orderId: payload.orderId,
          });

          logger.info(
            `[Event] Successfully reserved inventory for Order: ${payload.orderId}`,
          );

          // 5. 🚨 NEW: NOTIFY ADMINS ABOUT OUT OF STOCK ITEMS
          // Send alerts via the Notification Service
          for (const product of newlyOutOfStock) {
            await publishEvent("stream:notifications", {
              eventType: "SystemAlert",
              targetRole: "ADMINISTRATOR",
              title: "Product Out of Stock ⚠️",
              message: `"${product.name}" has sold out and requires restocking.`,
              type: "INVENTORY_ALERT",
              link: `/admin/products/${product.id}`,
            });
            logger.info(
              `[Alert] Published OutOfStock alert for ${product.name}`,
            );
          }
        } catch (error) {
          logger.error(
            `[Event Error] Failed to reserve inventory for ${payload.orderId}: ${error.message}`,
          );

          // 6. If inventory is missing, tell the order service to FAIL the order and alert the user
          await publishEvent("stream:products", {
            eventType: "OutOfStock",
            orderId: payload.orderId,
            reason: error.message,
          });
        }
      }
    },
  );
};
