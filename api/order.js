// GET /api/order?payment_intent=pi_...   (Apple Pay / Google Pay buttons)
// GET /api/order?session_id=cs_...       (card checkout page)
//   ->  order status, and the code once it's ready. The success page polls this.
import { fulfill, fulfillPaymentIntent, reloadly, findProduct, json } from "./_lib.js";

export async function GET(request) {
  const q = new URL(request.url).searchParams;
  const sessionId = q.get("session_id") || "";
  const piId = q.get("payment_intent") || "";
  const noStore = { "cache-control": "no-store" };

  let run;
  if (/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)) run = () => fulfill(sessionId);
  else if (/^pi_[A-Za-z0-9]+$/.test(piId)) run = () => fulfillPaymentIntent(piId);
  else return json({ error: "Invalid order link." }, 400);

  try {
    const result = await run();
    if (result.state !== "done") return json({ state: result.state }, 200, noStore);

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
