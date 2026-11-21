// POST /api/logout  ->  signs out
import { json } from "./_lib.js";
import { endSession, cookie } from "./_limits.js";

export async function POST(request) {
  try { await endSession(request); } catch (err) { console.error(err); }
  return json({ ok: true }, 200, { "set-cookie": cookie("noir_session", "", 0) });
}
