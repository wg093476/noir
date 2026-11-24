// POST /api/crypto-webhook  <- NOWPayments calls this as a crypto payment progresses.
// When it's "finished" (fully paid and confirmed on the blockchain) we buy the card;
// Reloadly then emails the code to the customer.
import {
  verifyNowpaymentsSignature, parseCryptoOrderId, findProduct, priceFor,
  placeOrder, isDuplicateOrder, json, cryptoSandbox, reloadlyLive, recordOrder,
} from "./_lib.js";
import { accountsEnabled, redis, reserve, release, sendEmail } from "./_limits.js";
import { adminEmails } from "./_verify.js";
import crypto from "node:crypto";

const site = () => process.env.SITE_URL || "https://www.noirgc.com";

// After a crypto order: tell the customer the code is on its way, with a link to review the order.
// Sent once per order, even if NOWPayments repeats the webhook.
async function thankYouEmail(orderId, email, product, amount) {
  if (!accountsEnabled() || !process.env.RESEND_API_KEY) return;
  if ((await redis("SET", "cryptomail:" + orderId, "1", "NX", "EX", 60 * 60 * 24 * 30)) !== "OK") return;
  const token = crypto.randomBytes(18).toString("base64url");
  await redis("SET", "cryptoreview:" + token,
    JSON.stringify({ orderId, productId: product.id, amount, brand: product.brand || product.name }),
    "EX", 60 * 60 * 24 * 60);
  const link = `${site()}/success.html?review=${token}`;
  await sendEmail(email, `Your ${product.name} $${amount} order`,
    `Thanks for your order! Your crypto payment went through and your ${product.name} $${amount} code ` +
    `is being emailed to you separately (check spam too).\n\n` +
    `How did it go? Leave a quick review: ${link}\n\nQuestions? Reply to support@noirgc.com.\n\nNOIR`);
}

// If a paid crypto order can't be filled, email the owner (once per order) so the customer is helped fast.
async function failureAlert(body, err) {
  if (!accountsEnabled() || !process.env.RESEND_API_KEY) return;
  if ((await redis("SET", "cryptofail:" + body.order_id, "1", "NX", "EX", 60 * 60 * 24 * 30)) !== "OK") return;
  const text =
    `A customer paid with crypto but the card couldn't be bought.\n\n` +
    `Order: ${body.order_id}\nNOWPayments payment: ${body.payment_id}\n` +
    `Customer: ${String(body.order_description || "")}\nPaid: ${body.price_amount} ${body.price_currency}\n` +
    `Error: ${err.message}\n\n` +
    `NOWPayments keeps retrying for a while, so if it was a low wallet, topping up Reloadly may fix it by itself. ` +
    `Otherwise refund the customer from the NOWPayments dashboard.`;
  for (const to of adminEmails()) await sendEmail(to, "NOIR: crypto order needs attention", text);
}

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

  // A NOWPayments test payment must never buy a real card.
  if (cryptoSandbox() && reloadlyLive()) {
    console.error("Test crypto payment ignored while Reloadly is live:", body.order_id);
    return json({ received: true, fulfilled: false });
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
    let saved = null;
    if (accountsEnabled()) {
      saved = JSON.parse((await redis("GET", "crypto:" + body.order_id)) || "null");
      if (saved) await reserve(saved.tier, saved.ids, order.amount, { force: true });
    }

    let result;
    try {
      result = await placeOrder({
        productId: order.productId,
        amount: order.amount,
        email,
        orderRef: body.order_id,
      });
    } catch (err) {
      // supplier still working on it: keep the saved order and undo the hold (the resend counts it again)
      if (err.pending && saved) await release(saved.ids, order.amount).catch(() => {});
      if (!err.pending && accountsEnabled()) await redis("DEL", "crypto:" + body.order_id).catch(() => {});
      throw err;
    }
    if (accountsEnabled()) await redis("DEL", "crypto:" + body.order_id).catch(() => {});
    console.log("Crypto order fulfilled", body.order_id, result.transactionId);
    const u = (saved?.ids || []).find((x) => x.startsWith("u:"));
    if (u) {
      await recordOrder(u.slice(2), { kind: "crypto", ref: body.order_id, productId: order.productId, amount: order.amount })
        .catch((e) => console.error("couldn't save order to account:", e.message));
    }
    await thankYouEmail(body.order_id, email, product, order.amount).catch((e) => console.error("thank-you email failed:", e.message));
    return json({ received: true, fulfilled: true });
  } catch (err) {
    if (isDuplicateOrder(err)) return json({ received: true, fulfilled: true });
    // supplier still working on it: answer "try again" so NOWPayments resends; the same order is re-checked
    if (err.pending) return json({ error: "still processing" }, 503);
    // Crypto can't be refunded automatically. Shows in Vercel logs + NOWPayments dashboard.
    console.error("CRYPTO ORDER FAILED — customer paid, refund manually:", body.order_id, body.payment_id, err.message);
    await failureAlert(body, err).catch((e) => console.error("failure alert failed:", e.message));
    return json({ error: "retry" }, 500);
  }
}
