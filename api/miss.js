// POST /api/miss  { q }  <- the homepage reports searches that found no card.
// Shows up in Vercel -> Logs as SEARCH_MISS, so you can see which brands people want.
export async function POST(request) {
  try {
    const { q } = JSON.parse(await request.text());
    const clean = String(q || "").replace(/[^\w $.&'-]/g, "").trim().slice(0, 60);
    if (clean) console.log("SEARCH_MISS", JSON.stringify(clean));
  } catch {}
  return new Response(null, { status: 204 });
}
