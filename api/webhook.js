// POST /api/webhook  <- Stripe calls this when a payment finishes.
// Orders the card from Reloadly even if the customer closed the tab.
import { verifyStripeSignature, fulfill, json } from "./_lib.js";

export async function POST(request) {
  const raw = await request.text();
  const ok = verifyStripeSignature(
    raw,
    request.headers.get("stripe-signature"),
    process.env.STRIPE_WEBHOOK_SECRET
  );
  if (!ok) return json({ error: "Bad signature" }, 400);

  const event = JSON.parse(raw);
  if (
    event.type === "checkout.session.completed" ||
    event.type === "checkout.session.async_payment_succeeded"
  ) {
    try {
      const result = await fulfill(event.data.object.id);
      return json({ received: true, state: result.state });
    } catch (err) {
      console.error("Fulfillment error", err);
      return json({ error: "retry" }, 500); // Stripe will retry later
    }
  }
  return json({ received: true });
}
