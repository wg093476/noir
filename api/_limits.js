// Accounts, sign-in and daily spending limits for NOIR.
// Not an endpoint (files starting with "_" aren't). Uses Upstash Redis over its REST API
// and Resend for sign-in emails — both plain fetch calls, no npm packages.
//
// Levels (per UTC day, counted in gift card value):
//   guest     no account                      LIMIT_GUEST     default $500
//   account   signed in with an email code    LIMIT_ACCOUNT   default $1,500
//   verified  ID approved by NOIR             LIMIT_VERIFIED  default $5,000
// To make someone verified, set their user record's "tier" to "verified" in Upstash
// (key: user:<email>). A NOIR admin page for this comes with the ID review feature.

import crypto from "node:crypto";

const env = (name, fallback) => {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
};

export const tierLimit = (tier) =>
  Number(
    tier === "verified" ? env("LIMIT_VERIFIED", "5000")
    : tier === "account" ? env("LIMIT_ACCOUNT", "1500")
    : env("LIMIT_GUEST", "500")
  );

const redisUrl = () => env("UPSTASH_REDIS_REST_URL", env("KV_REST_API_URL", ""));
const redisToken = () => env("UPSTASH_REDIS_REST_TOKEN", env("KV_REST_API_TOKEN", ""));

// Limits and accounts only switch on once the database is connected.
export const accountsEnabled = () => Boolean(redisUrl() && redisToken());

export async function redis(...command) {
  const res = await fetch(redisUrl(), {
    method: "POST",
    headers: { authorization: "Bearer " + redisToken(), "content-type": "application/json" },
    body: JSON.stringify(command.map(String)),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error("Redis: " + (data.error || res.status));
  return data.result;
}

const sha = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");

// ---------- cookies + who is buying ----------

export function readCookies(request) {
  const out = {};
  for (const part of (request.headers.get("cookie") || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export const cookie = (name, value, maxAgeSec) =>
  `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAgeSec}; HttpOnly; Secure; SameSite=Lax`;

export const clientIp = (request) =>
  (request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "")
    .split(",")[0].trim() || "unknown";

export const normEmail = (e) => String(e || "").trim().toLowerCase();
export const validEmail = (e) => /^[^\s@|]+@[^\s@|]+\.[^\s@|]{2,}$/.test(e) && e.length <= 200;

// Signed-in user from the session cookie, or null.
export async function currentUser(request) {
  if (!accountsEnabled()) return null;
  const token = readCookies(request).noir_session;
  if (!token) return null;
  const email = await redis("GET", "session:" + sha(token));
  if (!email) return null;
  const user = JSON.parse((await redis("GET", "user:" + email)) || "null") || { tier: "account" };
  return { email, tier: user.tier === "verified" ? "verified" : "account" };
}

// Everything we track spending against for this buyer.
// Accounts: the account. Guests: their browser, their network and (when known) their email,
// so making a new email doesn't reset the limit.
export async function buyer(request, email) {
  const user = await currentUser(request);
  const device = readCookies(request).noir_device || "";
  const ids = [];
  if (user) ids.push("u:" + user.email);
  else {
    if (/^[A-Za-z0-9_-]{16,64}$/.test(device)) ids.push("d:" + device);
    ids.push("ip:" + sha(clientIp(request)).slice(0, 24));
    if (email && validEmail(normEmail(email))) ids.push("e:" + normEmail(email));
  }
  return { tier: user ? user.tier : "guest", email: user?.email || null, ids };
}

// A shared network (school, office) holds several honest guests, so it gets 3x the guest limit.
const capFor = (id, tier) => (id.startsWith("ip:") ? tierLimit("guest") * 3 : tierLimit(tier));
const dayKey = (id) => "spend:" + new Date().toISOString().slice(0, 10) + ":" + id;
const cents = (usd) => Math.round(Number(usd) * 100);

// How much more this buyer can spend today (in dollars).
export async function remaining(tier, ids) {
  if (!accountsEnabled() || !ids.length) return Infinity;
  const spent = await redis("MGET", ...ids.map(dayKey));
  let left = Infinity;
  ids.forEach((id, i) => { left = Math.min(left, capFor(id, tier) * 100 - Number(spent[i] || 0)); });
  return Math.max(0, left) / 100;
}

// Count a purchase against every id. If that pushes any of them over the limit,
// undo it and return false (the caller then refunds instead of sending a card).
export async function reserve(tier, ids, amountUsd, { force = false } = {}) {
  if (!accountsEnabled() || !ids.length) return true;
  const c = cents(amountUsd);
  const done = [];
  let over = false;
  for (const id of ids) {
    const total = Number(await redis("INCRBY", dayKey(id), c));
    done.push(id);
    if (total === c) await redis("EXPIRE", dayKey(id), 60 * 60 * 48);
    if (total > capFor(id, tier) * 100) over = true;
  }
  if (over && !force) {
    await release(done, amountUsd);
    return false;
  }
  return true;
}

export async function release(ids, amountUsd) {
  if (!accountsEnabled()) return;
  for (const id of ids) await redis("DECRBY", dayKey(id), cents(amountUsd));
}

// Short message for when an order is over the limit.
export function limitMessage(tier, left) {
  const l = "$" + Math.floor(left).toLocaleString("en-US");
  if (tier === "guest")
    return `That's over the guest limit — ${l} left today. Sign in to raise your limit to $${tierLimit("account").toLocaleString("en-US")}/day.`;
  if (tier === "account") return `That's over your daily limit — ${l} left today.`;
  return `That's over your daily limit — ${l} left today.`;
}

// ---------- sign-in by emailed code ----------

export async function sendEmail(to, subject, text, html) {
  if (!process.env.RESEND_API_KEY) throw new Error("Email isn't set up (RESEND_API_KEY)");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: "Bearer " + process.env.RESEND_API_KEY.trim(), "content-type": "application/json" },
    body: JSON.stringify({ from: env("EMAIL_FROM", "NOIR <login@noirgc.com>"), to: [to], subject, text, html }),
  });
  if (!res.ok) throw new Error("Email failed: " + res.status + " " + (await res.text()).slice(0, 200));
}

export async function startSignIn(email, ip) {
  // at most 5 codes per email and 20 per network each hour
  for (const [key, max] of [["codes:e:" + email, 5], ["codes:ip:" + sha(ip).slice(0, 24), 20]]) {
    const n = Number(await redis("INCR", key));
    if (n === 1) await redis("EXPIRE", key, 3600);
    if (n > max) return { error: "Too many codes requested — try again in an hour.", status: 429 };
  }
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  await redis("SET", "code:" + email, sha(code + email), "EX", 600);
  await redis("DEL", "tries:" + email);
  await sendEmail(
    email,
    `${code} is your NOIR sign-in code`,
    `Your NOIR sign-in code is ${code}\n\nIt expires in 10 minutes. If you didn't ask for it, ignore this email.`,
    `<div style="font-family:monospace;background:#000;color:#fff;padding:32px;text-align:center">
      <div style="font-size:28px;letter-spacing:10px;margin-bottom:24px">NOIR</div>
      <div style="color:#999;font-size:13px">Your sign-in code</div>
      <div style="font-size:36px;letter-spacing:8px;margin:12px 0 20px">${code}</div>
      <div style="color:#666;font-size:12px">Expires in 10 minutes. Didn't ask for this? Ignore this email.</div>
    </div>`
  );
  return { ok: true };
}

export async function finishSignIn(email, code) {
  const tries = Number(await redis("INCR", "tries:" + email));
  if (tries === 1) await redis("EXPIRE", "tries:" + email, 600);
  if (tries > 5) return { error: "Too many wrong codes — request a new one.", status: 429 };
  const stored = await redis("GET", "code:" + email);
  const given = sha(String(code || "").trim() + email);
  if (!stored || stored.length !== given.length ||
      !crypto.timingSafeEqual(Buffer.from(stored), Buffer.from(given))) {
    return { error: "That code isn't right.", status: 400 };
  }
  await redis("DEL", "code:" + email, "tries:" + email);
  await redis("SET", "user:" + email, JSON.stringify({ tier: "account", created: Date.now() }), "NX");
  const token = crypto.randomBytes(32).toString("base64url");
  await redis("SET", "session:" + sha(token), email, "EX", 60 * 60 * 24 * 30);
  return { ok: true, token };
}

export async function endSession(request) {
  const token = readCookies(request).noir_session;
  if (token && accountsEnabled()) await redis("DEL", "session:" + sha(token));
}
