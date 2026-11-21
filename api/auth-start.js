// POST /api/auth-start  { email }  ->  emails a 6-digit sign-in code
import { json } from "./_lib.js";
import { accountsEnabled, startSignIn, normEmail, validEmail, clientIp } from "./_limits.js";

export async function POST(request) {
  if (!accountsEnabled()) return json({ error: "Accounts aren't available yet." }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ error: "Bad request." }, 400); }
  const email = normEmail(body.email);
  if (!validEmail(email)) return json({ error: "Enter a valid email." }, 400);
  try {
    const r = await startSignIn(email, clientIp(request));
    if (r.error) return json({ error: r.error }, r.status);
    return json({ ok: true });
  } catch (err) {
    console.error(err);
    return json({ error: "Couldn't send the code right now — try again in a minute." }, 502);
  }
}
