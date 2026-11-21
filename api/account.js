// /api/account — accounts in one endpoint (Vercel's free plan allows 12 functions).
//   GET                                   -> who's signed in, their level and what they can still spend today
//   POST { action: "start",  email }      -> emails a 6-digit sign-in code
//   POST { action: "verify", email, code} -> signs in (sets the session cookie)
//   POST { action: "logout" }             -> signs out
//   POST { action: "id-submit", name, idType, idPhoto, selfie, consent } -> sends ID for review (signed in)
import crypto from "node:crypto";
import { json } from "./_lib.js";
import {
  accountsEnabled, buyer, remaining, tierLimit, readCookies, cookie,
  startSignIn, finishSignIn, endSession, normEmail, validEmail, clientIp,
  currentUser,
} from "./_limits.js";
import { getUser, verificationStatus, submitVerification, isAdmin } from "./_verify.js";

const DEVICE_RE = /^[A-Za-z0-9_-]{16,64}$/;

export async function GET(request) {
  const headers = { "cache-control": "no-store" };
  if (!accountsEnabled()) return json({ accounts: false }, 200, headers);

  // Every browser gets a random id, so guest limits can't be dodged with new emails.
  let device = readCookies(request).noir_device;
  if (!DEVICE_RE.test(device || "")) {
    device = crypto.randomBytes(18).toString("base64url");
    headers["set-cookie"] = cookie("noir_device", device, 60 * 60 * 24 * 365);
    // let the rest of this request count against the new id
    request = new Request(request.url, {
      headers: { ...Object.fromEntries(request.headers), cookie: (request.headers.get("cookie") || "") + "; noir_device=" + device },
    });
  }
  try {
    const b = await buyer(request);
    const left = await remaining(b.tier, b.ids);
    const extra = {};
    if (b.email) {
      extra.verification = verificationStatus(await getUser(b.email));
      extra.verifiedLimit = tierLimit("verified");
      if (isAdmin({ email: b.email })) extra.admin = true;
    }
    return json({
      ...extra,
      accounts: true,
      signedIn: Boolean(b.email),
      email: b.email,
      tier: b.tier,
      limit: tierLimit(b.tier),
      remaining: Math.floor(left),
      accountLimit: tierLimit("account"),
    }, 200, headers);
  } catch (err) {
    console.error(err);
    return json({ accounts: true, signedIn: false, tier: "guest", limit: tierLimit("guest"), remaining: null }, 200, headers);
  }
}

export async function POST(request) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "Bad request." }, 400); }

  if (body.action === "logout") {
    try { await endSession(request); } catch (err) { console.error(err); }
    return json({ ok: true }, 200, { "set-cookie": cookie("noir_session", "", 0) });
  }

  if (!accountsEnabled()) return json({ error: "Accounts aren't available yet." }, 503);

  if (body.action === "id-submit") {
    const user = await currentUser(request);
    if (!user) return json({ error: "Sign in first." }, 401);
    try {
      const r = await submitVerification(user.email, body);
      if (r.error) return json({ error: r.error }, r.status);
      return json({ ok: true });
    } catch (err) {
      console.error(err);
      return json({ error: "Couldn't send your ID right now — try again in a minute." }, 502);
    }
  }

  const email = normEmail(body.email);
  if (!validEmail(email)) return json({ error: "Enter a valid email." }, 400);

  if (body.action === "start") {
    try {
      const r = await startSignIn(email, clientIp(request));
      if (r.error) return json({ error: r.error }, r.status);
      return json({ ok: true });
    } catch (err) {
      console.error(err);
      return json({ error: "Couldn't send the code right now — try again in a minute." }, 502);
    }
  }

  if (body.action === "verify") {
    try {
      const r = await finishSignIn(email, body.code);
      if (r.error) return json({ error: r.error }, r.status);
      return json({ ok: true, email, tier: "account", limit: tierLimit("account") }, 200, {
        "set-cookie": cookie("noir_session", r.token, 60 * 60 * 24 * 30),
      });
    } catch (err) {
      console.error(err);
      return json({ error: "Couldn't sign you in right now — try again." }, 502);
    }
  }

  return json({ error: "Unknown action." }, 400);
}
