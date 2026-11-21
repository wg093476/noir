// ID verification for the Verified level ($5,000/day). Not an endpoint.
// Built in-house: the customer uploads an ID photo and a selfie, NOIR reviews them by hand on
// /admin.html, and the photos are deleted as soon as a decision is made (or after 30 days).
// Photos are encrypted (AES-256-GCM) before they're stored in Upstash.

import crypto from "node:crypto";
import { redis, normEmail, sendEmail, tierLimit } from "./_limits.js";

const env = (name, fallback) => {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
};

const PHOTO_TTL = 60 * 60 * 24 * 30; // photos never stay longer than 30 days
const MAX_PHOTO_BYTES = 700 * 1024; // the page shrinks photos before sending, so real ones are far smaller
export const ID_TYPES = { license: "Driver's license", state_id: "State ID", passport: "Passport" };
export const REJECT_REASONS = {
  unreadable: "The photos were blurry or cut off.",
  mismatch: "The selfie or name didn't match the ID.",
  expired: "The ID is expired.",
  duplicate: "This ID is already linked to another NOIR account.",
  other: "We couldn't verify your ID.",
};

// Admins are whoever controls these inboxes (sign in with them on noirgc.com).
export const adminEmails = () =>
  env("ADMIN_EMAILS", "support@noirgc.com").split(",").map(normEmail).filter(Boolean);
export const isAdmin = (user) => Boolean(user && adminEmails().includes(user.email));

// ---------- encryption ----------

function photoKey() {
  const secret = env("ID_SECRET", "") || env("UPSTASH_REDIS_REST_TOKEN", "") || env("KV_REST_API_TOKEN", "");
  if (!secret) throw new Error("No key for ID photos");
  return crypto.createHash("sha256").update("noir-id-photos:" + secret).digest();
}
function encrypt(buf) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", photoKey(), iv);
  const ct = Buffer.concat([c.update(buf), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
}
function decrypt(b64) {
  const raw = Buffer.from(b64, "base64");
  const d = crypto.createDecipheriv("aes-256-gcm", photoKey(), raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]);
}

// A data: URL from the page -> JPEG bytes, or null if it isn't a real, small JPEG.
function jpegFrom(dataUrl) {
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ""));
  if (!m) return null;
  const buf = Buffer.from(m[1], "base64");
  if (buf.length < 2000 || buf.length > MAX_PHOTO_BYTES) return null;
  if (buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) return null; // JPEG magic bytes
  return buf;
}

// ---------- user records ----------

export async function getUser(email) {
  return JSON.parse((await redis("GET", "user:" + email)) || "null") || { tier: "account" };
}
async function saveUser(email, user) {
  await redis("SET", "user:" + email, JSON.stringify(user));
}

// What the storefront shows about a signed-in customer's verification.
export function verificationStatus(user) {
  if (user.tier === "verified") return { status: "verified" };
  const v = user.verify || {};
  if (v.status === "pending") return { status: "pending" };
  if (v.status === "rejected") return { status: "rejected", reason: REJECT_REASONS[v.reason] || REJECT_REASONS.other };
  return { status: "none" };
}

// ---------- customer: submit ----------

export async function submitVerification(email, body) {
  const user = await getUser(email);
  if (user.tier === "verified") return { error: "You're already verified.", status: 400 };
  if (user.verify?.status === "pending") return { error: "Your ID is already being reviewed.", status: 400 };
  if (body.consent !== true) return { error: "Please tick the box to agree to the ID check.", status: 400 };

  const name = String(body.name || "").replace(/\s+/g, " ").trim();
  if (name.length < 3 || name.length > 80 || !/^[\p{L}' .-]+$/u.test(name) || !name.includes(" "))
    return { error: "Enter your full legal name, exactly as it's printed on your ID.", status: 400 };
  if (!ID_TYPES[body.idType]) return { error: "Choose the type of ID.", status: 400 };
  const front = jpegFrom(body.idPhoto);
  const selfie = jpegFrom(body.selfie);
  if (!front || !selfie) return { error: "Both photos are needed — try taking them again.", status: 400 };

  // at most 3 tries a day per account
  const n = Number(await redis("INCR", "idtries:" + email));
  if (n === 1) await redis("EXPIRE", "idtries:" + email, 60 * 60 * 24);
  if (n > 3) return { error: "Too many tries today — please try again tomorrow.", status: 429 };

  const id = crypto.randomBytes(12).toString("hex");
  await redis("SET", "idphoto:" + id + ":id", encrypt(front), "EX", PHOTO_TTL);
  await redis("SET", "idphoto:" + id + ":selfie", encrypt(selfie), "EX", PHOTO_TTL);
  await redis("SET", "idreq:" + id, JSON.stringify({
    id, email, name, idType: body.idType, submitted: Date.now(), consentAt: Date.now(),
  }), "EX", PHOTO_TTL);
  await redis("SADD", "idqueue", id);
  user.verify = { status: "pending", reqId: id, submitted: Date.now() };
  await saveUser(email, user);
  return { ok: true };
}

// ---------- admin: review ----------

export async function listPending() {
  const ids = (await redis("SMEMBERS", "idqueue")) || [];
  const out = [];
  for (const id of ids) {
    const req = JSON.parse((await redis("GET", "idreq:" + id)) || "null");
    if (!req) { await redis("SREM", "idqueue", id); continue; } // expired after 30 days
    out.push({ ...req, idTypeLabel: ID_TYPES[req.idType] });
  }
  return out.sort((a, b) => a.submitted - b.submitted);
}

export async function getPhoto(id, which) {
  if (!/^[a-f0-9]{24}$/.test(id) || !["id", "selfie"].includes(which)) return null;
  const b64 = await redis("GET", "idphoto:" + id + ":" + which);
  return b64 ? decrypt(b64) : null;
}

// One ID per account: we keep only a scrambled fingerprint of the ID number, never the number.
const idFingerprint = (idType, number) =>
  crypto.createHash("sha256").update("noir-idnum:" + idType + ":" + String(number).toUpperCase().replace(/[^A-Z0-9]/g, "")).digest("hex");

export async function decide(id, { approve, reason, idNumber }, adminEmail) {
  if (!/^[a-f0-9]{24}$/.test(String(id))) return { error: "Bad request.", status: 400 };
  const req = JSON.parse((await redis("GET", "idreq:" + id)) || "null");
  if (!req) return { error: "That request is gone (already decided or expired).", status: 404 };
  const user = await getUser(req.email);

  if (approve) {
    const clean = String(idNumber || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (clean.length < 4) return { error: "Type the ID number from the photo so we can stop it being reused.", status: 400 };
    const fp = idFingerprint(req.idType, clean);
    const taken = await redis("SET", "idnum:" + fp, req.email, "NX");
    if (taken === null) {
      const owner = await redis("GET", "idnum:" + fp);
      if (owner !== req.email) return { error: "This ID is already used by another account (" + owner + "). Reject it as a duplicate.", status: 409 };
    }
    user.tier = "verified";
    user.verifiedName = req.name;
    user.verifiedAt = Date.now();
    user.verify = { status: "verified", by: adminEmail };
  } else {
    if (!REJECT_REASONS[reason]) return { error: "Choose a reason.", status: 400 };
    user.verify = { status: "rejected", reason, by: adminEmail, at: Date.now() };
  }
  await saveUser(req.email, user);

  // The photos are deleted the moment a decision is made.
  await redis("DEL", "idphoto:" + id + ":id", "idphoto:" + id + ":selfie", "idreq:" + id);
  await redis("SREM", "idqueue", id);

  const limit = "$" + tierLimit("verified").toLocaleString("en-US");
  try {
    if (approve) {
      await sendEmail(req.email, "You're verified on NOIR",
        `Your ID has been approved. You can now buy up to ${limit} of gift cards a day.\n\nPay with a card in your own name (${req.name}) to use the higher limit. Your ID photos have been deleted.`,
        `<div style="font-family:monospace;background:#000;color:#fff;padding:32px;text-align:center"><div style="font-size:28px;letter-spacing:10px;margin-bottom:20px">NOIR</div><div>You're verified. You can now buy up to ${limit} a day.</div><div style="color:#888;font-size:12px;margin-top:14px">Pay with a card in your own name to use the higher limit. Your ID photos have been deleted.</div></div>`);
    } else {
      const why = REJECT_REASONS[reason];
      await sendEmail(req.email, "About your NOIR ID check",
        `We couldn't verify your ID: ${why}\n\nYou can try again from noirgc.com. Your photos have been deleted.`,
        `<div style="font-family:monospace;background:#000;color:#fff;padding:32px;text-align:center"><div style="font-size:28px;letter-spacing:10px;margin-bottom:20px">NOIR</div><div>We couldn't verify your ID.</div><div style="color:#aaa;margin-top:10px">${why}</div><div style="color:#888;font-size:12px;margin-top:14px">You can try again from noirgc.com. Your photos have been deleted.</div></div>`);
    }
  } catch (err) {
    console.error("Decision email failed", err.message); // the decision itself is saved
  }
  return { ok: true };
}

// ---------- the payer has to be the verified person ----------

const nameParts = (s) =>
  String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z\s'-]/g, " ").split(/\s+/).filter((w) => w.length > 0);

// Same first initial and same last name (middle names and suffixes can differ).
export function namesMatch(verified, payer) {
  const a = nameParts(verified), b = nameParts(payer);
  if (a.length < 2 || b.length < 2) return false;
  const suffix = new Set(["jr", "sr", "ii", "iii", "iv"]);
  const last = (p) => [...p].reverse().find((w) => !suffix.has(w));
  return a[0][0] === b[0][0] && last(a) === last(b);
}

// A verified buyer only gets the verified limit when the card is in their name.
export async function effectiveTier(tier, ids, payerName) {
  if (tier !== "verified") return tier;
  const email = (ids.find((i) => i.startsWith("u:")) || "").slice(2);
  if (!email) return "account";
  const user = await getUser(email);
  return user.tier === "verified" && namesMatch(user.verifiedName, payerName) ? "verified" : "account";
}
