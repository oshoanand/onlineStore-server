import Stripe from "stripe";

if (!process.env.STRIPE_SECRET_KEY) {
  console.error(
    "[Stripe Error] Missing STRIPE_SECRET_KEY in environment variables",
  );
}

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2026-04-22.dahlia", // Always lock your API version
});
