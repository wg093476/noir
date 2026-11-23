// GET /api/order?payment_intent=pi_...   (Apple Pay / Google Pay buttons)
// GET /api/order?session_id=cs_...       (card checkout page)
//   ->  order status, and the code once it's ready. The success page polls this.
// GET  /api/order?reviews=1[&offset=0&stars=5]  -> public reviews + rating summary
// POST /api/order { session_id | payment_intent | review, rating, text, name } -> review a completed order
//   (review = the token from the link in a crypto order email)
import { fulfill, fulfillPaymentIntent, reloadly, findProduct, json, deliveredCount } from "./_lib.js";
import { accountsEnabled, clientIp, redis } from "./_limits.js";
import { addReview, listReviews } from "./_reviews.js";

// Look up a completed order from the link on the success page.
async function completedOrder(sessionId, piId, reviewToken) {
  // crypto orders: the review link in the order email carries a one-off token
  if (/^[A-Za-z0-9_-]{20,40}$/.test(reviewToken || "")) {
    const saved = JSON.parse((await redis("GET", "cryptoreview:" + reviewToken)) || "null");
    if (!saved) return null;
    return { state: "done", pi: { id: "crypto:" + saved.orderId, metadata: { productId: saved.productId, amount: saved.amount } } };
  }
  let result;
  try {
    if (/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId || "")) result = await fulfill(sessionId);
    else if (/^pi_[A-Za-z0-9]+$/.test(piId || "")) result = await fulfillPaymentIntent(piId);
    else return null;
  } catch {
    return null; // unknown order
  }
  return result.state === "done" ? result : null;
}

export async function POST(request) {
  if (!accountsEnabled()) return json({ error: "Reviews aren't open yet." }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ error: "Bad request." }, 400); }
  try {
    const result = await completedOrder(body.session_id, body.payment_intent, body.review);
    if (!result) return json({ error: "Only completed orders can be reviewed." }, 403);
    const meta = result.pi.metadata || {};
    const product = await findProduct(meta.productId).catch(() => null);
    const r = await addReview(
      { key: result.pi.id, brand: product?.brand || product?.name, amount: meta.amount },
      body, clientIp(request));
    if (r.error) return json({ error: r.error }, r.status);
    return json({ ok: true });
  } catch (err) {
    console.error(err);
    return json({ error: "Couldn't save your review — try again." }, 502);
  }
}

export async function GET(request) {
  const q = new URL(request.url).searchParams;
  if (q.get("reviews")) {
    if (!accountsEnabled()) return json({ count: 0, average: null, breakdown: {}, total: 0, reviews: [] });
    try {
      const data = await listReviews({
        offset: Math.max(0, Number(q.get("offset")) || 0),
        limit: Math.min(50, Number(q.get("limit")) || 20),
        stars: [1, 2, 3, 4, 5].includes(Number(q.get("stars"))) ? Number(q.get("stars")) : 0,
      });
      data.delivered = await deliveredCount().catch(() => 0);
      return json(data, 200, { "cache-control": "public, s-maxage=60, stale-while-revalidate=300" });
    } catch (err) {
      console.error(err);
      return json({ count: 0, average: null, breakdown: {}, total: 0, reviews: [] });
    }
  }
  const sessionId = q.get("session_id") || "";
  const piId = q.get("payment_intent") || "";
  const noStore = { "cache-control": "no-store" };

  let run;
  if (/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)) run = () => fulfill(sessionId);
  else if (/^pi_[A-Za-z0-9]+$/.test(piId)) run = () => fulfillPaymentIntent(piId);
  else return json({ error: "Invalid order link." }, 400);

  try {
    const result = await run();
    if (result.state !== "done") {
      const reason = result.reason || result.pi?.metadata?.noir_refund_reason || undefined;
      return json({ state: result.state, reason }, 200, noStore);
    }

    const meta = result.pi.metadata || {};
    const product = await findProduct(meta.productId);

    let cards = await reloadly(`/orders/transactions/${result.transactionId}/cards`);
    if (!Array.isArray(cards)) cards = [cards];

    return json(
      {
        state: "done",
        name: product?.name || "Gift card",
        logo: product?.logo || null,
        amount: Number(meta.amount),
        email: meta.email || result.pi.receipt_email || null,
        redeem: product?._redeem || "",
        cards: cards.map((c) => ({
          code: c.cardNumber != null ? String(c.cardNumber) : null,
          pin: c.pinCode || null,
          url: c.redemptionUrl || null,
        })),
      },
      200,
      noStore
    );
  } catch (err) {
    console.error(err);
    return json({ state: "processing" }, 200, noStore);
  }
}
