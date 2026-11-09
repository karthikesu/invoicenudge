# InvoiceNudge v0.4.3 (private local prototype)

Paste a messy job chat, get a clean invoice, pay it through the PayPal SANDBOX.
Clean-room: no KARTS code or data. Zero dependencies. Node 18+.

## Run it

    cp .env.example .env        # Windows: copy .env.example .env
    # edit .env: add your own free Groq key and your PayPal SANDBOX client ID and secret
    npm start                   # http://127.0.0.1:3000
    npm test                    # 17 offline tests, no network, no keys needed

Open the page, paste e.g.

    ok bro confirm ya. wedding video edit = RM 800, also 2 x reels for insta at RM 60 each. client: Arun and Priya. due in 2 weeks

Expected: RM920.00, wedding video edit x1 at RM800, reels x2 at RM60, client Arun and Priya, due in 14 days.
The page shows `Parsed by: AI (Groq) | Payments: PayPal SANDBOX` (or `rules (fallback)` / `mock` when keys are missing).
Click Pay, log in with a sandbox PERSONAL buyer account (developer.paypal.com > Testing Tools > Sandbox Accounts), approve; the return page shows `Payment COMPLETED (PayPal SANDBOX)`.

## How it works

- `src/groq.js`: calls Groq (JSON mode, temperature 0, 8 s timeout) and picks a model the key can use. The chat text is treated as untrusted data. The model output is strictly validated (max 20 items, qty and price bounds, currency MYR or USD only, due 1 to 365 days) and totals are always recomputed on the server. Any error, timeout or bad output falls back to the rule parser in `src/ai.js`, and the reason is printed in the terminal.
- `src/paypal-live.js`: PayPal Orders v2, hard-wired to `api-m.sandbox.paypal.com` (there is no live switch). The approve link is accepted only if it is on sandbox.paypal.com, and capture happens only for orders this server created and only after approval.
- `src/paypal.js`: offline mock used when `PAYPAL_MODE=sandbox` or the credentials are missing.
- `public/`: browser UI, uses `textContent` only.

## Security

- Every value written into HTML goes through `escapeHtml`; CSP and `nosniff` headers are sent; regression tests cover script payloads in job text and in order ids.
- Secrets live only in a local `.env` (git-ignored, never in the zip). Use test or free keys only.

## Honest limits

- Sandbox only: no real money moves and no live PayPal credentials are supported.
- The chat parser is built for short freelancer-style job chats; unusual wording may need a manual check of the table before paying.
- Runs on localhost only; no deployment, accounts or database.
- The offline tests mock the network. The live Groq and PayPal sandbox paths were verified by hand on a laptop (two sandbox payments completed).
