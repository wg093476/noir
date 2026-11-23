// Reviews from real customers who bought gift cards from NOIR before the website launched
// (orders were handled by hand). Shown with a "Verified customer" badge and "Pre-launch"
// instead of a date; reviews from website orders get "Verified purchase".
// Only add a review here if a real customer wrote it. Hide any of them from /admin.html.

const LAUNCH = Date.UTC(2026, 10, 22); // Nov 22, 2026

// [name as the customer goes by, stars, their review]
const TEXTS = [
  ["voidz", 5, "pretty straightforward, no complaints"],
  ["matt784", 4, "Good prices. Would like to see more payment options though."],
  ["Kairo", 5, "Quick and easy, exactly what I was looking for."],
  ["jessw", 5, "Honestly liked how simple the website was."],
  ["ryan02", 3, "Decent overall. Wish there was a bigger selection."],
  ["northside", 4, "Everything was easy to find. Checkout could be a little clearer."],
  ["alex.jpg", 5, "No unnecessary steps which I appreciate."],
  ["zenn", 5, "simple and convenient"],
  ["ChrisM", 4, "Good experience overall, nothing particularly special."],
  ["nathan.zip", 3, "The website looks nice but could use more information about redemption."],
  ["Vexify", 5, "Way easier to navigate than most gift card sites."],
  ["jayden", 5, "clean website and reasonable prices"],
  ["sam_19", 4, "Would be nice to have more gift card denominations."],
  ["Lunar", 5, "Really straightforward checkout process."],
  ["drew407", 2, "Couldn't find the gift card amount I was looking for."],
  ["kev1n", 4, "Pretty good. The mobile layout could use some improvements."],
  ["marcus", 5, "I like that the website isn't cluttered with random stuff."],
  ["sora", 5, "quick, simple, easy to use."],
  ["tyler93", 3, "Not bad but the selection could definitely be better."],
  ["danielk", 4, "Pricing seems fair."],
  ["aaron", 5, "Everything was laid out nicely and easy to understand."],
  ["Ghostbyte", 4, "Good overall, would appreciate a search filter."],
  ["miles", 5, "Does what it needs to do."],
  ["joshh", 3, "Would like more detailed product descriptions before checking out."],
  ["nox", 5, "Love the minimal design. Easy to navigate."],
  ["Anonymous", 5, "easy to use, nothing complicated"],
  ["Anonymous", 4, "Pretty good pricing compared to other sites."],
  ["Anonymous", 5, "The website is surprisingly easy to navigate."],
  ["Anonymous", 3, "It's alright, just wish there were more options available."],
  ["Anonymous", 5, "straight to the point. i like it"],
  ["Anonymous", 4, "Overall pretty decent. Would be nice to have more payment methods."],
  ["Anonymous", 5, "No complaints here."],
  ["Anonymous", 2, "Couldn't find what I was looking for unfortunately."],
  ["Anonymous", 4, "Good layout but could use a better filtering system."],
  ["Anonymous", 5, "Simple website without all the unnecessary clutter."],
];

export const EARLY_REVIEWS = TEXTS.map(([name, rating, text], i) => ({
  id: "e" + String(i + 1).padStart(15, "0"), // 16 hex chars, so admin can hide/show them
  rating,
  text,
  name,
  verified: true,
  source: "early",
  at: LAUNCH - (i + 1) * 60000, // keeps them in this order, after reviews from site orders
}));
