// POST /api/intent  { productId, amount, email }  ->  { clientSecret }
// Used by the Apple Pay / Google Pay / Link buttons on the card page.
import { findProduct, isValidAmount, priceFor, stripe, json } from "./_lib.js";

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Bad request." }, 400);
  }
  const amount = Number(body.amount);
  const email = String(body.email || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 200) {
    return json({ error: "Your wallet didn't share an email — try again or pay with card." }, 400);
  }

  try {
    const product = await findProduct(body.productId);
    if (!product) return json({ error: "Gift card not found." }, 404);
    if (!isValidAmount(product, amount)) return json({ error: "That amount isn't available." }, 400);

    const { total } = priceFor(product, amount);
    const pi = await stripe("/payment_intents", {
      method: "POST",
      params: {
        amount: Math.round(total * 100), // must match the amount shown on the page
        currency: "usd",
        automatic_payment_methods: { enabled: true },
        receipt_email: email,
        description: `${product.name} — $${amount}`,
        metadata: { productId: product.id, amount, email, noir_flow: "express" },
      },
    });
    return json({ clientSecret: pi.client_secret });
  } catch (err) {
    console.error(err);
    return json({ error: "Payment isn't available right now." }, 502);
  }
}
