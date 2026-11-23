// GET /api/quote?productId=123&amount=50  ->  { face, fee, total }
import { findProduct, isValidAmount, priceFor, json, walletCovers, OUT_OF_STOCK } from "./_lib.js";

export async function GET(request) {
  const url = new URL(request.url);
  const amount = Number(url.searchParams.get("amount"));
  try {
    const product = await findProduct(url.searchParams.get("productId"));
    if (!product) return json({ error: "Gift card not found." }, 404);
    if (!isValidAmount(product, amount)) return json({ error: "That amount isn't available." }, 400);
    if (!(await walletCovers(product, amount))) return json({ error: OUT_OF_STOCK, stock: true }, 409);
    const { face, fee, total } = priceFor(product, amount);
    return json({ face, fee, total });
  } catch (err) {
    console.error(err);
    return json({ error: "Could not get a price right now." }, 502);
  }
}
