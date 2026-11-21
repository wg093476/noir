// Shared helpers for the NOIR backend.
// Files starting with "_" inside /api are NOT turned into endpoints by Vercel.
// No npm packages needed: everything uses Node's built-in fetch + crypto.

import crypto from "node:crypto";

// ---------- settings (from Vercel Environment Variables) ----------

const env = (name, fallback) => {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
};

export const settings = () => ({
  reloadlyMode: env("RELOADLY_MODE", "sandbox"), // "sandbox" or "live"
  serviceFeePercent: Number(env("SERVICE_FEE_PERCENT", "5")), // your markup in %
  serviceFeeFlat: Number(env("SERVICE_FEE_FLAT", "0.99")), // plus a flat fee in $
  maxCardUsd: Number(env("MAX_CARD_USD", "100")), // biggest card one order can buy
  country: env("STORE_COUNTRY", "US"),
});

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...extraHeaders },
  });
}

export const round2 = (n) => Math.round(n * 100) / 100;

// ---------- Reloadly ----------

const reloadlyBase = () =>
  settings().reloadlyMode === "live"
    ? "https://giftcards.reloadly.com"
    : "https://giftcards-sandbox.reloadly.com";

let tokenCache = { token: null, expiresAt: 0 };

async function reloadlyToken() {
  if (tokenCache.token && Date.now() < tokenCache.expiresAt) return tokenCache.token;
  const res = await fetch("https://auth.reloadly.com/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.RELOADLY_CLIENT_ID,
      client_secret: process.env.RELOADLY_CLIENT_SECRET,
      grant_type: "client_credentials",
      audience: reloadlyBase(),
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error("Reloadly login failed: " + (data.message || res.status));
  }
  // refresh a few minutes early
  const life = (Number(data.expires_in) || 3600) * 1000;
  tokenCache = { token: data.access_token, expiresAt: Date.now() + life - 5 * 60 * 1000 };
  return data.access_token;
}

export async function reloadly(path, { method = "GET", body } = {}) {
  const token = await reloadlyToken();
  const res = await fetch(reloadlyBase() + path, {
    method,
    headers: {
      authorization: "Bearer " + token,
      accept: "application/com.reloadly.giftcards-v1+json",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  // Long numeric codes (16+ digits) would lose digits as JS numbers, so keep them as text.
  const text = (await res.text()).replace(/("(?:cardNumber|pinCode)"\s*:\s*)(\d{12,})/g, '$1"$2"');
  let data = {};
  try {
    data = JSON.parse(text);
  } catch {}
  if (!res.ok) {
    const err = new Error(data.message || data.errorCode || "Reloadly error " + res.status);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

// ---------- catalog + pricing ----------

let catalogCache = { items: null, at: 0 };

// Simplified product list, cached for 10 minutes.
export async function getCatalog() {
  if (catalogCache.items && Date.now() - catalogCache.at < 10 * 60 * 1000) {
    return catalogCache.items;
  }
  const { country, maxCardUsd } = settings();
  const raw = await reloadly(`/countries/${country}/products`);
  const list = Array.isArray(raw) ? raw : raw.content || [];
  const items = list
    .filter((p) => p.recipientCurrencyCode === "USD" && (p.status || "ACTIVE") === "ACTIVE")
    .map((p) => {
      const fixed = (p.fixedRecipientDenominations || [])
        .map(Number)
        .filter((d) => d > 0 && d <= maxCardUsd)
        .sort((a, b) => a - b);
      const isRange = p.denominationType === "RANGE";
      return {
        id: p.productId,
        name: p.productName,
        brand: p.brand?.brandName || p.productName,
        logo: (p.logoUrls || [])[0] || null,
        type: isRange ? "range" : "fixed",
        amounts: isRange ? [] : fixed,
        min: isRange ? Number(p.minRecipientDenomination) : null,
        max: isRange ? Math.min(Number(p.maxRecipientDenomination), maxCardUsd) : null,
        // private cost info, removed before sending to the browser
        _senderFee: Number(p.senderFee) || 0,
        _senderFeePercent: Number(p.senderFeePercentage) || 0,
        _discountPercent: Number(p.discountPercentage) || 0,
        _redeem: p.redeemInstruction?.concise || "",
      };
    })
    .filter((p) => (p.type === "fixed" ? p.amounts.length > 0 : p.min <= p.max));
  catalogCache = { items, at: Date.now() };
  return items;
}

export const publicProduct = (p) =>
  Object.fromEntries(Object.entries(p).filter(([k]) => !k.startsWith("_")));

export async function findProduct(id) {
  const items = await getCatalog();
  return items.find((p) => String(p.id) === String(id)) || null;
}

export function isValidAmount(product, amount) {
  if (!Number.isFinite(amount) || amount <= 0) return false;
  if (product.type === "fixed") return product.amounts.includes(amount);
  return amount >= product.min && amount <= product.max && round2(amount) === amount;
}

// What the customer pays. Always computed on the server.
export function priceFor(product, amount) {
  const { serviceFeePercent, serviceFeeFlat } = settings();
  // what Reloadly charges you for this card
  const cost =
    amount * (1 - product._discountPercent / 100) +
    product._senderFee +
    amount * (product._senderFeePercent / 100);
  let total = amount * (1 + serviceFeePercent / 100) + serviceFeeFlat;
  // never sell below cost + Stripe's fee (2.9% + 30¢) + a 1% cushion
  const floor = (cost + 0.3) / (1 - 0.039);
  if (total < floor) total = floor;
  total = Math.ceil(total * 100) / 100;
  return { face: round2(amount), fee: round2(total - amount), total, cost: round2(cost) };
}

// ---------- Stripe (plain REST calls) ----------

function formEncode(obj, prefix, out = []) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === "object") formEncode(v, key, out);
    else out.push(encodeURIComponent(key) + "=" + encodeURIComponent(String(v)));
  }
  return out.join("&");
}

export async function stripe(path, { method = "GET", params, idempotencyKey } = {}) {
  const headers = { authorization: "Bearer " + (process.env.STRIPE_SECRET_KEY || "").trim() };
  let url = "https://api.stripe.com/v1" + path;
  let body;
  if (params && method === "GET") url += "?" + formEncode(params);
  else if (params) {
    body = formEncode(params);
    headers["content-type"] = "application/x-www-form-urlencoded";
  }
  if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
  const res = await fetch(url, { method, headers, body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error("Stripe: " + (data.error?.message || res.status));
  return data;
}

// Checks the Stripe-Signature header so nobody can fake a "payment succeeded" call.
export function verifyStripeSignature(rawBody, header, secret, toleranceSec = 300) {
  secret = (secret || "").trim();
  if (!header || !secret) return false;
  const parts = Object.fromEntries(
    header.split(",").map((kv) => {
      const i = kv.indexOf("=");
      return [kv.slice(0, i).trim(), kv.slice(i + 1).trim()];
    })
  );
  const t = Number(parts.t);
  const sigs = header
    .split(",")
    .filter((kv) => kv.trim().startsWith("v1="))
    .map((kv) => kv.trim().slice(3));
  if (!t || sigs.length === 0) return false;
  if (Math.abs(Date.now() / 1000 - t) > toleranceSec) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  return sigs.some((s) => {
    const a = Buffer.from(s, "hex");
    const b = Buffer.from(expected, "hex");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
}

// ---------- buying the card ----------

// Buys one card from Reloadly. orderRef must be unique per customer payment:
// Reloadly refuses the same customIdentifier twice, so a card can't be bought twice.
export function placeOrder({ productId, amount, email, orderRef }) {
  return reloadly("/orders", {
    method: "POST",
    body: {
      productId: Number(productId),
      countryCode: settings().country,
      quantity: 1,
      unitPrice: Number(amount),
      customIdentifier: orderRef,
      senderName: "NOIR",
      recipientEmail: email,
    },
  });
}

export const isDuplicateOrder = (err) =>
  /duplicate|already|custom.?identifier/.test(String(err?.message || "").toLowerCase());

// ---------- fulfillment ----------
// Works for both ways of paying with Stripe:
//   - Apple Pay / Google Pay / Link buttons on the page (a PaymentIntent we create)
//   - the "Pay with card" checkout page (a Checkout Session, which also has a PaymentIntent)
// It's used by BOTH the webhook and the success page, so the customer gets their code
// even if one of them is slow. Progress is stored on the PaymentIntent's metadata,
// so no database is needed.

async function fulfillIntent(pi, email) {
  const meta = pi.metadata || {};
  if (meta.noir_status === "done") return { state: "done", transactionId: meta.reloadly_tx, pi };
  if (meta.noir_status === "refunded") return { state: "refunded", pi };
  // Another attempt is ordering right now. If it got stuck for over 2 minutes,
  // try again (Reloadly's customIdentifier check still blocks a double order).
  const startedAgo = Date.now() / 1000 - Number(meta.noir_started || 0);
  if (meta.noir_status === "processing" && startedAgo < 120) return { state: "processing", pi };

  await stripe(`/payment_intents/${pi.id}`, {
    method: "POST",
    params: {
      metadata: { noir_status: "processing", noir_started: Math.floor(Date.now() / 1000) },
    },
  });

  try {
    const order = await placeOrder({
      productId: meta.productId,
      amount: meta.amount,
      email,
      orderRef: pi.id,
    });
    await stripe(`/payment_intents/${pi.id}`, {
      method: "POST",
      params: { metadata: { noir_status: "done", reloadly_tx: order.transactionId } },
    });
    return { state: "done", transactionId: String(order.transactionId), pi };
  } catch (err) {
    if (isDuplicateOrder(err)) {
      // The card was already ordered by another attempt; don't refund.
      return { state: "processing", pi };
    }
    // Card could not be bought (out of stock, low wallet balance...). Give the money back.
    await stripe("/refunds", {
      method: "POST",
      params: { payment_intent: pi.id, metadata: { reason: "reloadly_failed" } },
      idempotencyKey: "refund-" + pi.id,
    });
    await stripe(`/payment_intents/${pi.id}`, {
      method: "POST",
      params: {
        metadata: { noir_status: "refunded", noir_error: String(err.message).slice(0, 400) },
      },
    });
    console.error("Order failed, refunded", pi.id, err.message, err.data);
    return { state: "refunded", pi };
  }
}

// Card checkout page (Checkout Session)
export async function fulfill(sessionId) {
  const session = await stripe(`/checkout/sessions/${sessionId}`, {
    params: { "expand[]": "payment_intent" },
  });
  if (session.payment_status !== "paid") return { state: "unpaid" };
  const email = session.customer_details?.email || session.customer_email;
  return fulfillIntent(session.payment_intent, email);
}

// Apple Pay / Google Pay / Link buttons on the page (PaymentIntent)
export async function fulfillPaymentIntent(piId) {
  const pi = await stripe(`/payment_intents/${piId}`);
  if (pi.status === "processing") return { state: "processing", pi };
  if (pi.status !== "succeeded") return { state: "unpaid", pi };
  return fulfillIntent(pi, pi.metadata?.email || pi.receipt_email);
}

// ---------- crypto (NOWPayments: BTC, ETH, USDT, USDC and 350+ more) ----------

export const cryptoEnabled = () => Boolean(process.env.NOWPAYMENTS_API_KEY);

// Sandbox unless NOWPAYMENTS_SANDBOX is set to "false".
export const cryptoSandbox = () => env("NOWPAYMENTS_SANDBOX", "true") === "true";

const nowBase = () =>
  cryptoSandbox()
    ? "https://api-sandbox.nowpayments.io/v1"
    : "https://api.nowpayments.io/v1";

export async function nowpayments(path, body) {
  const res = await fetch(nowBase() + path, {
    method: body ? "POST" : "GET",
    headers: {
      "x-api-key": process.env.NOWPAYMENTS_API_KEY,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error("NOWPayments: " + (data.message || res.status));
  return data;
}

// Order ids look like noir_<productId>_<amount>_<random>, so the webhook
// knows what to buy without needing a database.
export function makeCryptoOrderId(productId, amount) {
  return `noir_${productId}_${amount}_${crypto.randomBytes(6).toString("hex")}`;
}

export function parseCryptoOrderId(id) {
  const m = /^noir_(\d+)_(\d+(?:\.\d{1,2})?)_[0-9a-f]{12}$/.exec(String(id || ""));
  return m ? { productId: m[1], amount: Number(m[2]) } : null;
}

function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    return Object.keys(v).sort().reduce((o, k) => ((o[k] = sortKeys(v[k])), o), {});
  }
  return v;
}

// NOWPayments signs the JSON body (keys sorted A-Z) with HMAC-SHA512 + your IPN secret.
export function verifyNowpaymentsSignature(body, header, secret) {
  secret = (secret || "").trim();
  if (!header || !secret) return false;
  const expected = crypto
    .createHmac("sha512", secret)
    .update(JSON.stringify(sortKeys(body)))
    .digest("hex");
  const a = Buffer.from(String(header).trim().toLowerCase(), "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
