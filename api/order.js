// GET /api/order?session_id=cs_...  ->  order status, and the code once it's ready.
// The success page polls this after payment.
import { fulfill, reloadly, findProduct, stripe, json } from "./_lib.js";

export async function GET(request) {
  const sessionId = new URL(request.url).searchParams.get("session_id") || "";
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)) {
    return json({ error: "Invalid order link." }, 400);
  }
  const noStore = { "cache-control": "no-store" };

  try {
    const result = await fulfill(sessionId);
    if (result.state !== "done") return json({ state: result.state }, 200, noStore);

    const session = await stripe(`/checkout/sessions/${sessionId}`);
    const product = await findProduct(session.metadata.productId);

    let cards = await reloadly(`/orders/transactions/${result.transactionId}/cards`);
    if (!Array.isArray(cards)) cards = [cards];

    return json(
      {
        state: "done",
        name: product?.name || "Gift card",
        logo: product?.logo || null,
        amount: Number(session.metadata.amount),
        email: session.customer_details?.email || null,
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
