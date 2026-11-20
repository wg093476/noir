// POST /api/crypto-checkout  { productId, amount, email }  ->  { url }  (NOWPayments page)
// The customer picks BTC, ETH, USDT, USDC or another coin on that page.
import {
  findProduct, isValidAmount, priceFor, json,
  cryptoEnabled, nowpayments, makeCryptoOrderId,
} from "./_lib.js";

export async function POST(request) {
  if (!cryptoEnabled()) return json({ error: "Crypto payments aren't set up yet." }, 503);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Bad request." }, 400);
  }
  const amount = Number(body.amount);
  const email = String(body.email || "").trim();
  if (!/^[^\s@|]+@[^\s@|]+\.[^\s@|]{2,}$/.test(email) || email.length > 200) {
    return json({ error: "Enter a valid email — your code is sent there." }, 400);
  }

  try {
    const product = await findProduct(body.productId);
    if (!product) return json({ error: "Gift card not found." }, 404);
    if (!isValidAmount(product, amount)) return json({ error: "That amount isn't available." }, 400);

    const { total } = priceFor(product, amount);
    const site = process.env.SITE_URL || new URL(request.url).origin;
    const orderId = makeCryptoOrderId(product.id, amount);

    const invoice = await nowpayments("/invoice", {
      price_amount: total,
      price_currency: "usd",
      order_id: orderId,
      // the email rides along here (not in a URL) so the webhook knows where to send the code
      order_description: `${product.name} $${amount} | ${email}`,
      ipn_callback_url: `${site}/api/crypto-webhook`,
      success_url: `${site}/success.html?crypto=1`,
      cancel_url: `${site}/`,
    });
    if (!invoice.invoice_url) throw new Error("No invoice URL returned");
    return json({ url: invoice.invoice_url });
  } catch (err) {
    console.error(err);
    return json({ error: "Crypto checkout isn't available right now." }, 502);
  }
}
