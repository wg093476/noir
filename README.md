# NOIR

Digital gift card store at [noirgc.com](https://www.noirgc.com).

- `index.html` – storefront (search, brand tiles, checkout)
- `success.html` – shows the gift card code after payment
- `about.html`, `contact.html`, `refund.html`, `terms.html`, `privacy.html` – store pages
- `api/` – Vercel serverless functions (Reloadly gift cards, Stripe payments, NOWPayments crypto)
- `assets/` – shared styles, footer, icons

Keys and settings live in Vercel → Settings → Environment Variables, never in this repo.

Testing: while the Stripe keys are `*_test_*` and `RELOADLY_MODE` is `sandbox`, pay with card `4242 4242 4242 4242` (any future date, any CVC). Codes delivered in sandbox are fake.
