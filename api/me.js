// GET /api/me  ->  who's signed in, their level and how much they can still spend today.
// Also gives every browser a random id, so guest limits can't be dodged with new emails.
import crypto from "node:crypto";
import { json } from "./_lib.js";
import { accountsEnabled, buyer, remaining, tierLimit, readCookies, cookie } from "./_limits.js";

export async function GET(request) {
  const headers = { "cache-control": "no-store" };
  if (!accountsEnabled()) return json({ accounts: false }, 200, headers);

  let device = readCookies(request).noir_device;
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(device || "")) {
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
    return json({
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
