// POST /api/crypto-webhook  <- NOWPayments calls this as a crypto payment progresses.
// When it's "finished" (fully paid and confirmed on the blockchain) we buy the card;
// Reloadly then emails the code to the customer.
import {
  verifyNowpaymentsSignature, parseCryptoOrderId, findProduct, priceFor,
  placeOrder, isDuplicateOrder, json,
} from "./_lib.js";
import { accountsEnabled, redis, reserve } from "./_limits.js";

export async function POST(request) {
  const raw = await request.text();
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: "Bad request" }, 400);
  }

  const ok = verifyNowpaymentsSignature(
    body,
    request.headers.get("x-nowpayments-sig"),
    process.env.NOWPAYMENTS_IPN_SECRET
  );
  if (!ok) return json({ error: "Bad signature" }, 400);

  // waiting / confirming / confirmed / sending / partially_paid / failed / expired...
  // Only a fully paid, finished payment gets a card.
  if (body.payment_status !== "finished") {
    if (body.payment_status === "partially_paid") {
      console.warn("Crypto underpaid — no card sent. Refund or top-up needed:", body.order_id, body.payment_id);
    }
    return json({ received: true, status: body.payment_status });
  }

  const order = parseCryptoOrderId(body.order_id);
  if (!order) return json({ error: "Unknown order" }, 400);

  const email = String(body.order_description || "").split("|").pop().trim();

  try {
    const product = await findProduct(order.productId);
    if (!product) throw new Error("Product no longer available: " + order.productId);

    // Never send a card for less than it costs you.
    const paidUsd = Number(body.price_amount);
    if (String(body.price_currency).toLowerCase() !== "usd" || !(paidUsd >= priceFor(product, order.amount).cost)) {
      console.error("Crypto amount too low — no card sent:", body.order_id, body.price_amount, body.price_currency);
      return json({ received: true, fulfilled: false });
    }

    // Count it toward the buyer's daily limit (it was checked before they paid).
    if (accountsEnabled()) {
      const saved = JSON.parse((await redis("GET", "crypto:" + body.order_id)) || "null");
      if (saved) await reserve(saved.tier, saved.ids, order.amount, { force: true });
      await redis("DEL", "crypto:" + body.order_id);
    }

    const result = await placeOrder({
      productId: order.productId,
      amount: order.amount,
      email,
      orderRef: body.order_id,
    });
    console.log("Crypto order fulfilled", body.order_id, result.transactionId);
    return json({ received: true, fulfilled: true });
  } catch (err) {
    if (isDuplicateOrder(err)) return json({ received: true, fulfilled: true });
    // Crypto can't be refunded automatically. Shows in Vercel logs + NOWPayments dashboard.
    console.error("CRYPTO ORDER FAILED — customer paid, refund manually:", body.order_id, body.payment_id, err.message);
    return json({ error: "retry" }, 500);
  }
}
