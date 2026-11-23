// POST /api/checkout  { productId, amount }  ->  { url }  (Stripe Checkout page)
import { findProduct, isValidAmount, priceFor, stripe, json, walletCovers, OUT_OF_STOCK, paymentsReady, PAUSED } from "./_lib.js";
import { buyer, remaining, limitMessage } from "./_limits.js";

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Bad request." }, 400);
  }
  const amount = Number(body.amount);

  try {
    if (!paymentsReady()) return json({ error: PAUSED }, 503);
    const product = await findProduct(body.productId);
    if (!product) return json({ error: "Gift card not found." }, 404);
    if (!isValidAmount(product, amount)) return json({ error: "That amount isn't available." }, 400);
    if (!(await walletCovers(product, amount))) return json({ error: OUT_OF_STOCK, stock: true }, 409);

    // daily spending limit (checked again when the payment completes)
    const who = await buyer(request);
    const left = await remaining(who.tier, who.ids);
    if (amount > left) return json({ error: limitMessage(who.tier, left), limit: true }, 403);
    const limitMeta = { noir_tier: who.tier, noir_ids: who.ids.join("|") };

    const { total } = priceFor(product, amount);
    const site = process.env.SITE_URL || new URL(request.url).origin;

    const session = await stripe("/checkout/sessions", {
      method: "POST",
      params: {
        mode: "payment",
        submit_type: "pay",
        line_items: {
          0: {
            quantity: 1,
            price_data: {
              currency: "usd",
              unit_amount: Math.round(total * 100),
              product_data: {
                name: `${product.name} — $${amount}`,
                description: "Digital gift card code, delivered instantly after payment.",
                images: product.logo ? { 0: product.logo } : undefined,
              },
            },
          },
        },
        customer_email: who.email || undefined,
        metadata: { productId: product.id, amount },
        payment_intent_data: { metadata: { productId: product.id, amount, ...limitMeta } },
        success_url: `${site}/success.html?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${site}/`,
        expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
      },
    });
    return json({ url: session.url });
  } catch (err) {
    console.error(err);
    return json({ error: "Checkout isn't available right now." }, 502);
  }
}
