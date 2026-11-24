// Bitrefill: a second gift card supplier, used for brands Reloadly doesn't carry (DoorDash...).
// Not an endpoint (files starting with "_" aren't). Turned on by adding, in Vercel:
//   BITREFILL_API_ID + BITREFILL_API_SECRET   (Business API, after Bitrefill approves you), or
//   BITREFILL_API_KEY                          (a personal API key)
// Cards are paid from your Bitrefill account balance, so keep it topped up like the Reloadly wallet.
//
// Safety: while the store is in test mode (RELOADLY_MODE isn't "live"), no real Bitrefill cards are
// shown, so a test payment can never buy a real card. The Bitrefill account's currency must be USD.

import { redis, accountsEnabled, sendEmail } from "./_limits.js";

const BASE = "https://api.bitrefill.com/v2";
export const BITREFILL_PREFIX = "b.";

export const bitrefillEnabled = () =>
  Boolean(process.env.BITREFILL_API_KEY || (process.env.BITREFILL_API_ID && process.env.BITREFILL_API_SECRET));

const storeLive = () => (process.env.RELOADLY_MODE || "sandbox") === "live";

function authHeader() {
  if (process.env.BITREFILL_API_ID && process.env.BITREFILL_API_SECRET) {
    const t = Buffer.from(`${process.env.BITREFILL_API_ID}:${process.env.BITREFILL_API_SECRET}`).toString("base64");
    return "Basic " + t;
  }
  return "Bearer " + process.env.BITREFILL_API_KEY;
}

export async function bitrefill(path, { method = "GET", body } = {}) {
  const url = path.startsWith("http") ? path : BASE + path;
  const res = await fetch(url, {
    method,
    headers: { authorization: authHeader(), "content-type": "application/json", accept: "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = { message: text }; }
  if (!res.ok) {
    const e = data?.error || data || {};
    const err = new Error(`Bitrefill ${res.status}: ${e.message || e.code || text.slice(0, 200)}`);
    err.code = e.code || null;
    err.data = data;
    throw err;
  }
  return data;
}

const isBitrefillId = (id) => String(id).startsWith(BITREFILL_PREFIX);
export const bitrefillIdOf = (id) => String(id).slice(BITREFILL_PREFIX.length);
export { isBitrefillId };

// "DoorDash USA" -> "doordash" (to spot brands Reloadly already has)
export const brandKey = (name) =>
  String(name || "").toLowerCase().replace(/\b(usa|us|united states)\b/g, "").replace(/[^a-z0-9]/g, "");

const catName = (c) => {
  const v = c && typeof c === "object" ? c.name || c.slug || c.id : c;
  return typeof v === "string" && v ? v.slice(0, 40) : null;
};

const saneRate = (x) => Number.isFinite(x) && x >= 0.5 && x <= 1.25;

function toItem(p, maxCardUsd) {
  const id = String(p.id || "");
  if (!/^[a-z0-9-]+$/.test(id)) return null;
  if (String(p.currency || "").toUpperCase() !== "USD" || p.in_stock === false) return null;
  const pk = Array.isArray(p.packages) ? p.packages : p.packages ? [p.packages] : [];
  const prices = {};
  const amounts = [];
  for (const k of pk) {
    const v = Number(k.value), price = Number(k.price);
    // Bitrefill quotes prices in the Bitrefill account's currency. Only sell when the price is clearly in
    // dollars (50%–125% of the card value); anything else (sats, euros...) is skipped, never guessed.
    if (v > 0 && v <= maxCardUsd && saneRate(price / v)) { amounts.push(v); prices[v] = { price, packageId: k.id || k.package_id }; }
  }
  const r = p.range && Number(p.range.max) > 0 ? p.range : null;
  const isRange = amounts.length === 0 && r && saneRate(Number(r.price_rate));
  if (!amounts.length && !isRange) return null;
  if (isRange && Math.min(Math.floor(Number(r.max)), maxCardUsd) < Math.max(Math.ceil(Number(r.min) || 1), 1)) return null;
  const name = String(p.name || id);
  return {
    id: BITREFILL_PREFIX + id,
    name,
    brand: name.replace(/\s+(USA|US)$/i, ""),
    // card-shaped picture from Bitrefill's image server
    logo: `https://cdn.bitrefill.com/primg/w400h250/${id}.webp`,
    category: catName(Array.isArray(p.categories) ? p.categories[0] : p.category),
    type: isRange ? "range" : "fixed",
    amounts: isRange ? [] : [...new Set(amounts)].sort((a, b) => a - b),
    min: isRange ? Math.max(Math.ceil(Number(r.min) || 1), 1) : null,
    max: isRange ? Math.min(Math.floor(Number(r.max)), maxCardUsd) : null,
    redeem: "",
    _supplier: "bitrefill",
    _bitPrices: prices,
    _priceRate: isRange ? Number(r.price_rate) : null,
    _senderFee: 0, _senderFeePercent: 0, _discountPercent: 0, _redeem: "",
  };
}

// US gift cards from Bitrefill (cached 30 min in the database + 10 min per server).
let mem = { items: null, at: 0 };
export async function bitrefillCatalog(maxCardUsd) {
  if (!bitrefillEnabled()) return [];
  if (mem.items && Date.now() - mem.at < 10 * 60 * 1000) return mem.items;
  const cacheKey = "bitrefill:catalog:v2:" + (storeLive() ? "live" : "test");
  // The saved list is kept for a day; after 30 minutes it's refreshed, and if Bitrefill is
  // slow or down the older list keeps being used.
  let saved = null;
  if (accountsEnabled()) {
    try { saved = JSON.parse((await redis("GET", cacheKey)) || "null"); } catch { saved = null; }
    if (saved && Array.isArray(saved.items) && Date.now() - saved.at < 30 * 60 * 1000) {
      mem = { items: saved.items, at: Date.now() };
      return mem.items;
    }
  }
  let raw = [];
  try {
    if (storeLive()) {
      // prices come in the Bitrefill account's currency, so it has to be USD
      const cur = await bitrefillCurrency();
      if (cur && cur !== "USD") {
        console.error(`Bitrefill account currency is ${cur}, not USD: Bitrefill cards hidden until it's switched to USD`);
        return [];
      }
      let next = "/products?country=US&type=gift_card&limit=50";
      for (let page = 0; next && page < 60; page++) {
        const d = await bitrefill(next);
        raw.push(...(d.data || []));
        next = d.meta?._next || null;
      }
      raw = raw.filter((p) => !String(p.id).startsWith("test-"));
    } else {
      const d = await bitrefill("/products/search?q=test&include_test_products=true&limit=50");
      raw = (d.data || []).filter((p) => /^test-gift-card-code$/.test(p.id));
    }
  } catch (err) {
    if (saved && Array.isArray(saved.items)) {
      console.error("Bitrefill catalog refresh failed, using the saved list:", err.message);
      mem = { items: saved.items, at: Date.now() };
      return mem.items;
    }
    throw err;
  }
  const items = raw.map((p) => toItem(p, maxCardUsd)).filter(Boolean);
  mem = { items, at: Date.now() };
  if (accountsEnabled()) await redis("SET", cacheKey, JSON.stringify({ items, at: Date.now() }), "EX", 24 * 60 * 60).catch(() => {});
  return items;
}

// What Bitrefill charges you for this card.
export function bitrefillCost(product, amount) {
  if (product._bitPrices && product._bitPrices[amount]) return product._bitPrices[amount].price;
  return Number(amount) * (product._priceRate || 1);
}

let balCache = { v: null, cur: null, at: 0 };
// The Bitrefill account's currency ("USD", "BTC"...), or null if it couldn't be checked.
export async function bitrefillCurrency() {
  await bitrefillBalance();
  return balCache.cur;
}
export async function bitrefillBalance({ fresh = false } = {}) {
  if (!bitrefillEnabled()) return null;
  if (!fresh && balCache.at && Date.now() - balCache.at < 60 * 1000) return balCache.v;
  try {
    const d = await bitrefill("/accounts/balance");
    const b = Number(d.data?.balance ?? d.balance);
    const cur = String(d.data?.currency ?? d.currency ?? "USD").toUpperCase();
    balCache = { v: Number.isFinite(b) && cur === "USD" ? b : null, cur, at: Date.now() };
  } catch (err) {
    console.error("Bitrefill balance check failed:", err.message);
    balCache = { v: null, cur: null, at: Date.now() };
  }
  return balCache.v;
}
export const forgetBitrefillBalance = () => { balCache.at = 0; };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FINAL = new Set(["complete", "denied", "payment_error"]);

// Buy one card. orderRef (the payment's id) makes this safe to call again: the invoice is
// remembered, so a retry checks the same invoice instead of buying a second card.
export async function bitrefillOrder({ product, amount, email, orderRef }) {
  const key = "bitinv:" + orderRef;
  let invoiceId = accountsEnabled() ? await redis("GET", key) : null;
  if (!invoiceId) {
    const line = { product_id: bitrefillIdOf(product.id), quantity: 1 };
    const pkg = product._bitPrices?.[amount]?.packageId;
    if (pkg) line.package_id = pkg; else line.value = Number(amount);
    const created = await bitrefill("/invoices", {
      method: "POST",
      body: { products: [line], payment_method: "balance", auto_pay: true },
    });
    invoiceId = created.data?.id;
    if (!invoiceId) throw new Error("Bitrefill didn't return an invoice");
    if (accountsEnabled()) await redis("SET", key, invoiceId, "EX", 60 * 60 * 24 * 30);
  }
  forgetBitrefillBalance();
  // usually instant; wait up to ~9 seconds, then let the next check pick it up
  const settled = (inv) =>
    FINAL.has(inv?.status) &&
    (inv.status !== "complete" || ["delivered", "failed", "refunded"].includes((inv.orders || [])[0]?.status));
  let inv = null;
  for (let i = 0; i < 9; i++) {
    inv = (await bitrefill(`/invoices/${invoiceId}`)).data;
    if (settled(inv)) break;
    await sleep(1000);
  }
  if (!settled(inv)) {
    const err = new Error("Bitrefill order still processing");
    err.pending = true; // the caller waits instead of refunding
    throw err;
  }
  if (inv.status !== "complete") throw new Error("Bitrefill payment " + inv.status);
  const order = (inv.orders || [])[0];
  if (!order) throw new Error("Bitrefill invoice has no order");
  if (["failed", "refunded"].includes(order.status)) throw new Error("Bitrefill order " + order.status);
  const transactionId = BITREFILL_PREFIX + order.id;
  // Reloadly emails its codes itself; Bitrefill doesn't, so NOIR sends this one (once per order).
  if (email) await emailCode({ product, amount, email, orderRef, transactionId }).catch((e) => console.error("code email failed:", e.message));
  return { transactionId };
}

async function emailCode({ product, amount, email, orderRef, transactionId }) {
  if (!process.env.RESEND_API_KEY) return;
  if (accountsEnabled() && (await redis("SET", "bitmail:" + orderRef, "1", "NX", "EX", 60 * 60 * 24 * 30)) !== "OK") return;
  const { cards, instructions } = await bitrefillCards(transactionId);
  const c = cards[0] || {};
  const lines = [];
  if (c.code) lines.push((c.pin ? "Card number: " : "Code: ") + c.code);
  if (c.pin) lines.push("PIN: " + c.pin);
  if (c.url) lines.push("Redeem link: " + c.url);
  if (!lines.length) return;
  await sendEmail(email, `Your ${product.name} $${amount} code`,
    `Thanks for shopping at NOIR! Here's your ${product.name} $${amount} gift card:\n\n${lines.join("\n")}\n\n` +
    (instructions ? `How to redeem: ${instructions}\n\n` : "") +
    `Keep this email safe: anyone with the code can use it.\n\nQuestions? Reply to support@noirgc.com.\n\nNOIR`);
}

// The code for a delivered order, in the same shape the success page uses.
export async function bitrefillCards(transactionId) {
  const d = await bitrefill(`/orders/${bitrefillIdOf(transactionId)}`);
  const ri = d.data?.redemption_info || {};
  return {
    cards: [{ code: ri.code || null, pin: ri.pin || null, url: ri.link || null }],
    instructions: String(ri.instructions || "").slice(0, 700),
  };
}
