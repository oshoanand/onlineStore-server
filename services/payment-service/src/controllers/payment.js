import prisma from "../config/prisma.js";
import { stripe } from "../config/stripe.js";
import { publishEvent } from "@shop/event-bus";
import { NotFoundError, BadRequestError, logger } from "@shop/utils";

/**
 * Called by the frontend to get the Stripe Client Secret before rendering the card element.
 */

export const createPaymentIntent = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const userId = req.headers["x-user-id"];

    const transaction = await prisma.paymentTransaction.findUnique({
      where: { orderId },
    });

    if (!transaction)
      throw new NotFoundError("Payment record not found for this order");
    if (transaction.userId !== userId)
      throw new BadRequestError("Unauthorized to pay for this order");

    // 🚨 SECURITY FIX: Reject attempts to pay online for a Cash on Delivery order
    if (transaction.status === "CASH_ON_DELIVERY") {
      throw new BadRequestError(
        "This order is set to Postpaid (Cash on Delivery) and does not require online payment.",
      );
    }

    if (transaction.status !== "PENDING") {
      throw new BadRequestError(
        `Order payment status is ${transaction.status}`,
      );
    }

    let stripeIntentId = transaction.stripeIntentId;
    let clientSecret = null;

    if (stripeIntentId) {
      const intent = await stripe.paymentIntents.retrieve(stripeIntentId);
      clientSecret = intent.client_secret;
    } else {
      const intent = await stripe.paymentIntents.create({
        amount: Math.round(parseFloat(transaction.amount) * 100),
        currency: transaction.currency || "rub",
        metadata: { orderId: transaction.orderId, userId: transaction.userId },
      });

      stripeIntentId = intent.id;
      clientSecret = intent.client_secret;

      await prisma.paymentTransaction.update({
        where: { id: transaction.id },
        data: { stripeIntentId },
      });
    }

    res.status(200).json({ status: "success", data: { clientSecret } });
  } catch (error) {
    next(error);
  }
};

/**
 * Webhook called by Stripe servers asynchronously.
 */
export const stripeWebhook = async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    // Verify the payload using the raw buffer from express.raw()
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET,
    );
  } catch (err) {
    logger.error(
      `[Stripe Webhook Error] Signature verification failed: ${err.message}`,
    );
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const intent = event.data.object;
  const orderId = intent.metadata.orderId;
  const userId = intent.metadata.userId; // Extracted directly from Stripe metadata

  try {
    switch (event.type) {
      case "payment_intent.succeeded":
        logger.info(`[Webhook] Payment Succeeded for Order: ${orderId}`);

        await prisma.paymentTransaction.updateMany({
          where: { stripeIntentId: intent.id },
          data: { status: "SUCCESS" },
        });

        // Publish event with userId included for robust notification routing
        await publishEvent("stream:payments", {
          eventType: "PaymentSucceeded",
          orderId,
          userId,
          stripeIntentId: intent.id,
        });
        break;

      case "payment_intent.payment_failed":
        logger.warn(`[Webhook] Payment Failed for Order: ${orderId}`);

        const errorMessage =
          intent.last_payment_error?.message || "Payment declined";

        await prisma.paymentTransaction.updateMany({
          where: { stripeIntentId: intent.id },
          data: {
            status: "FAILED",
            errorMessage: errorMessage,
          },
        });

        await publishEvent("stream:payments", {
          eventType: "PaymentFailed",
          orderId,
          userId,
          reason: errorMessage,
        });
        break;

      default:
        break;
    }

    res.json({ received: true });
  } catch (dbError) {
    logger.error(
      `[Webhook Process Error] DB/Publish failed for event ${event.id}:`,
      dbError,
    );
    res.status(500).end(); // 500 tells Stripe to retry this webhook later
  }
};
