// Customer reviews. Not an endpoint (used by /api/order and /api/admin).
// Only someone with a completed NOIR order can leave a review, one per order, so every
// review on the site is a real purchase. NOIR staff can hide abusive ones but can't edit them.

import crypto from "node:crypto";
import { redis } from "./_limits.js";
import { EARLY_REVIEWS } from "./_early-reviews.js";

const KEEP = 2000; // newest reviews kept

const clean = (s, max) =>
  String(s || "").replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

// "cohen example" -> "Cohen E."   (first name + last initial, never a full name)
function displayName(raw) {
  const parts = clean(raw, 40).split(" ").filter((w) => /^[\p{L}'-]+$/u.test(w));
  if (!parts.length) return "Anonymous";
  const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  return parts.length > 1 ? `${cap(parts[0])} ${parts.at(-1).charAt(0).toUpperCase()}.` : cap(parts[0]);
}

// order = { key, brand, amount } of a completed order
// username: the signed-in reviewer's username (set by the server, never taken from the form)
export async function addReview(order, { rating, text, name, anonymous }, ip, username = null) {
  const r = Number(rating);
  if (!Number.isInteger(r) || r < 1 || r > 5) return { error: "Pick 1 to 5 stars.", status: 400 };
  const body = clean(text, 600);

  // 10 reviews a day per network, so nobody can flood it
  const ipKey = "revip:" + crypto.createHash("sha256").update(String(ip)).digest("hex").slice(0, 24);
  const n = Number(await redis("INCR", ipKey));
  if (n === 1) await redis("EXPIRE", ipKey, 60 * 60 * 24);
  if (n > 10) return { error: "Too many reviews from this network today.", status: 429 };

  const first = await redis("SET", "review:order:" + order.key, "1", "NX");
  if (first === null) return { error: "You've already reviewed this order — thank you!", status: 409 };

  const review = {
    id: crypto.randomBytes(8).toString("hex"),
    rating: r,
    text: body,
    name: anonymous === true ? "Anonymous" : username || displayName(name),
    verified: true, // it came from a completed order
    brand: clean(order.brand, 40) || "Gift card",
    amount: Number(order.amount) || null,
    at: Date.now(),
  };
  await redis("LPUSH", "reviews", JSON.stringify(review));
  await redis("LTRIM", "reviews", 0, KEEP - 1);
  return { ok: true, review };
}

async function all() {
  const raw = (await redis("LRANGE", "reviews", 0, KEEP - 1)) || [];
  const hidden = new Set((await redis("SMEMBERS", "reviews:hidden")) || []);
  const fromSite = raw.map((s) => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean);
  // website reviews (newest first), then reviews from customers who bought before launch
  return [...fromSite, ...EARLY_REVIEWS].map((rv) => ({ ...rv, hidden: hidden.has(rv.id) }));
}

// Public: summary + a page of visible reviews (newest first, optionally only N stars).
export async function listReviews({ offset = 0, limit = 20, stars = 0 } = {}) {
  const visible = (await all()).filter((rv) => !rv.hidden);
  const breakdown = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  visible.forEach((rv) => breakdown[rv.rating]++);
  const count = visible.length;
  const average = count ? Math.round((visible.reduce((s, rv) => s + rv.rating, 0) / count) * 10) / 10 : null;
  const pool = stars ? visible.filter((rv) => rv.rating === stars) : visible;
  const page = pool.slice(offset, offset + limit).map(({ hidden, ...rv }) => rv);
  return { count, average, breakdown, total: pool.length, reviews: page };
}

// Admin: newest reviews including hidden ones.
export const adminReviews = async () => (await all()).slice(0, 200);

export async function setHidden(id, hide) {
  if (!/^[a-f0-9]{16}$/.test(String(id))) return { error: "Bad request.", status: 400 };
  await redis(hide ? "SADD" : "SREM", "reviews:hidden", id);
  return { ok: true };
}
