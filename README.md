# NOIR

Digital gift card store at [noirgc.com](https://www.noirgc.com).

- `index.html` – storefront (search, brand tiles, checkout)
- `success.html` – shows the gift card code after payment
- `about.html`, `contact.html`, `refund.html`, `terms.html`, `privacy.html` – store pages
- `api/` – Vercel serverless functions (Reloadly gift cards, Stripe payments, NOWPayments crypto)
- `assets/` – shared styles, footer, icons

Keys and settings live in Vercel → Settings → Environment Variables, never in this repo.

Testing: while the Stripe keys are `*_test_*` and `RELOADLY_MODE` is `sandbox`, pay with card `4242 4242 4242 4242` (any future date, any CVC). Codes delivered in sandbox are fake.
Crypto (BTC, ETH, USDT and more) goes through NOWPayments; it uses their sandbox while `NOWPAYMENTS_SANDBOX` is `true`.

Accounts and daily limits: guests $500/day, signed-in accounts $1,500/day, verified $5,000/day (`api/_limits.js`, `api/account.js`).
They switch on when the Upstash database is connected (`KV_REST_API_URL`, `KV_REST_API_TOKEN`); sign-in codes are emailed through Resend (`RESEND_API_KEY`, sending domain noirgc.com).
Verified: customers send an ID photo + selfie from the store; review them at noirgc.com/admin.html while signed in with an admin email (`ADMIN_EMAILS`, default support@noirgc.com). Photos are encrypted, deleted on decision (30 days max), and the verified limit only applies when the card is in the verified name (`api/_verify.js`).
