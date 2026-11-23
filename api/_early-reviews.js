// Reviews from real customers who bought gift cards from NOIR before the website launched
// (orders were handled by hand). Shown with a "Verified customer" badge and no date;
// reviews from website orders get "Verified purchase" and their date.
// Only add a review here if a real customer wrote it. Hide any of them from /admin.html.

const LAUNCH = Date.UTC(2026, 10, 22); // Nov 22, 2026

// [name as the customer goes by, stars, their review]
const TEXTS = [
  ["ryan02", 3, "Decent overall. Wish there was a bigger selection."],
  ["kev1n", 4, "Pretty good. The mobile layout could use some improvements."],
  ["Anonymous", 5, "straight to the point. i like it"],
  ["northside", 4, "Everything was easy to find. Checkout could be a little clearer."],
  ["joshh", 3, "Would like more detailed product descriptions before checking out."],
  ["Vexify", 5, "Way easier to navigate than most gift card sites."],
  ["drew407", 2, "Couldn't find the gift card amount I was looking for."],
  ["Anonymous", 2, "Couldn't find what I was looking for unfortunately."],
  ["sam_19", 4, "Would be nice to have more gift card denominations."],
  ["Anonymous", 5, "The website is surprisingly easy to navigate."],
  ["Ghostbyte", 4, "Good overall, would appreciate a search filter."],
  ["Anonymous", 4, "Good layout but could use a better filtering system."],
  ["voidz", 5, "pretty straightforward, no complaints"],
  ["miles", 5, "Does what it needs to do."],
  ["ChrisM", 4, "Good experience overall, nothing particularly special."],
  ["Anonymous", 3, "It's alright, just wish there were more options available."],
  ["zenn", 5, "simple and convenient"],
  ["Anonymous", 5, "Simple website without all the unnecessary clutter."],
  ["danielk", 4, "Pricing seems fair."],
  ["Lunar", 5, "Really straightforward checkout process."],
  ["Anonymous", 4, "Overall pretty decent. Would be nice to have more payment methods."],
  ["nox", 5, "Love the minimal design. Easy to navigate."],
  ["alex.jpg", 5, "No unnecessary steps which I appreciate."],
  ["marcus", 5, "I like that the website isn't cluttered with random stuff."],
  ["matt784", 4, "Good prices. Would like to see more payment options though."],
  ["tyler93", 3, "Not bad but the selection could definitely be better."],
  ["jayden", 5, "clean website and reasonable prices"],
  ["Anonymous", 5, "No complaints here."],
  ["sora", 5, "quick, simple, easy to use."],
  ["Anonymous", 4, "Pretty good pricing compared to other sites."],
  ["Kairo", 5, "Quick and easy, exactly what I was looking for."],
  ["jessw", 5, "Honestly liked how simple the website was."],
  ["Anonymous", 5, "easy to use, nothing complicated"],
  ["nathan.zip", 3, "The website looks nice but could use more information about redemption."],
  ["aaron", 5, "Everything was laid out nicely and easy to understand."],
];

export const EARLY_REVIEWS = TEXTS.map(([name, rating, text], i) => ({
  id: "e" + String(i + 1).padStart(15, "0"), // 16 hex chars, so admin can hide/show them
  rating,
  text,
  name,
  verified: true,
  source: "early",
  at: LAUNCH - (i + 1) * 60000, // keeps them in this (mixed) order, after reviews from site orders
}));
