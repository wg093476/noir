// POST /api/auth-verify  { email, code }  ->  signs in (sets the session cookie)
import { json } from "./_lib.js";
import { accountsEnabled, finishSignIn, normEmail, validEmail, cookie, tierLimit } from "./_limits.js";

export async function POST(request) {
  if (!accountsEnabled()) return json({ error: "Accounts aren't available yet." }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ error: "Bad request." }, 400); }
  const email = normEmail(body.email);
  if (!validEmail(email)) return json({ error: "Enter a valid email." }, 400);
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
