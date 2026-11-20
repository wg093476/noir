// GET /api/products  ->  list of gift cards you can sell (from Reloadly)
import { getCatalog, publicProduct, cryptoEnabled, json } from "./_lib.js";

function publishableKey() {
  const k = (process.env.STRIPE_PUBLISHABLE_KEY || "").trim();
  return k.startsWith("pk_") ? k : null;
}

export async function GET() {
  try {
    const items = (await getCatalog()).map(publicProduct);
    return json({
      products: items,
      crypto: cryptoEnabled(),
      // publishable key is meant to be public; it lets the page show Apple Pay / Google Pay.
      // Only ever send a pk_ key, so a secret key pasted in the wrong box never leaks.
      stripeKey: publishableKey(),
    }, 200, {
      "cache-control": "public, s-maxage=600, stale-while-revalidate=3600",
    });
  } catch (err) {
    console.error(err);
    return json({ error: "Could not load gift cards right now." }, 502);
  }
}
