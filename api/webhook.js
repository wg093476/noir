// POST /api/webhook  <- Stripe calls this when a payment finishes.
// Orders the card from Reloadly even if the customer closed the tab.
import { verifyStripeSignature, fulfill, fulfillPaymentIntent, json } from "./_lib.js";

export async function POST(request) {
  const raw = await request.text();
  const ok = verifyStripeSignature(
    raw,
    request.headers.get("stripe-signature"),
    process.env.STRIPE_WEBHOOK_SECRET
  );
  if (!ok) return json({ error: "Bad signature" }, 400);

  const event = JSON.parse(raw);
  const obj = event.data?.object || {};
  try {
    // "Pay with card" checkout page
    if (
      event.type === "checkout.session.completed" ||
      event.type === "checkout.session.async_payment_succeeded"
    ) {
      const result = await fulfill(obj.id);
      return json({ received: true, state: result.state });
    }
    // Apple Pay / Google Pay / Link buttons on the page
    if (event.type === "payment_intent.succeeded" && obj.metadata?.noir_flow === "express") {
      const result = await fulfillPaymentIntent(obj.id);
      return json({ received: true, state: result.state });
    }
  } catch (err) {
    console.error("Fulfillment error", err);
    return json({ error: "retry" }, 500); // Stripe will retry later
  }
  return json({ received: true });
}
