// /api/admin — NOIR's ID review (only for the emails in ADMIN_EMAILS, default support@noirgc.com).
//   GET                          -> ID checks waiting for review
//   GET ?photo=<id>&which=id     -> one photo (or which=selfie), only while it's waiting
//   POST { id, approve: true, idNumber }   -> approve (the ID number stops one ID being used twice)
//   POST { id, approve: false, reason }    -> reject
// Either way the photos are deleted straight away.
import { json } from "./_lib.js";
import { accountsEnabled, currentUser } from "./_limits.js";
import { isAdmin, listPending, getPhoto, decide, REJECT_REASONS } from "./_verify.js";

const NO_STORE = { "cache-control": "no-store, private", "x-robots-tag": "noindex" };

async function admin(request) {
  if (!accountsEnabled()) return null;
  const user = await currentUser(request);
  return isAdmin(user) ? user : null;
}

export async function GET(request) {
  try {
    const user = await admin(request);
    if (!user) return json({ error: "Not allowed." }, 403, NO_STORE);
    const url = new URL(request.url);
    const photoId = url.searchParams.get("photo");
    if (photoId) {
      const img = await getPhoto(photoId, url.searchParams.get("which"));
      if (!img) return json({ error: "Photo not found." }, 404, NO_STORE);
      return new Response(img, { status: 200, headers: { "content-type": "image/jpeg", ...NO_STORE } });
    }
    return json({ admin: user.email, pending: await listPending(), reasons: REJECT_REASONS }, 200, NO_STORE);
  } catch (err) {
    console.error(err);
    return json({ error: "Something went wrong." }, 500, NO_STORE);
  }
}

export async function POST(request) {
  // only from NOIR's own pages
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== new URL(request.url).host) return json({ error: "Not allowed." }, 403, NO_STORE);
  try {
    const user = await admin(request);
    if (!user) return json({ error: "Not allowed." }, 403, NO_STORE);
    let body;
    try { body = await request.json(); } catch { return json({ error: "Bad request." }, 400, NO_STORE); }
    const r = await decide(body.id, { approve: body.approve === true, reason: body.reason, idNumber: body.idNumber }, user.email);
    if (r.error) return json({ error: r.error }, r.status, NO_STORE);
    return json({ ok: true }, 200, NO_STORE);
  } catch (err) {
    console.error(err);
    return json({ error: "Something went wrong." }, 500, NO_STORE);
  }
}
