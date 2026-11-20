// GET /api/products  ->  list of gift cards you can sell (from Reloadly)
import { getCatalog, publicProduct, json } from "./_lib.js";

export async function GET() {
  try {
    const items = (await getCatalog()).map(publicProduct);
    return json({ products: items }, 200, {
      "cache-control": "public, s-maxage=600, stale-while-revalidate=3600",
    });
  } catch (err) {
    console.error(err);
    return json({ error: "Could not load gift cards right now." }, 502);
  }
}
