# OWNER TODO

> Items marked **TODO(owner)** in code and docs that need real data before launch.
> Updated at the end of each phase.

---

## Phase 0 — Monorepo setup

_No owner actions required for Phase 0._

---

## Open items (all phases)

### Brand identity

- [ ] Decide and register the final brand name (replaces every `[YOUR BRAND]` placeholder).
- [ ] Supply a logo file (SVG + PNG at 1×, 2×).
- [ ] Confirm brand colours match the existing palette, or flag changes early.

### Products & pricing

- [ ] Finalise the six product names, descriptions, "best for" lines and origin regions.
- [ ] Set real prices and MRP (in rupees) for each of the three sizes per product.
- [ ] Supply product photography for each product (uploaded to object storage via Admin; never `/placeholders/`).
- [ ] Create the real six products and variants in the Admin UI (`bootstrap:prod` creates an empty catalog).

### Batches & lab reports

- [ ] Supply first batch numbers, pressing dates and best-before dates (exactly one current batch per product).
- [ ] Upload lab report PDFs (to object storage with checksum) for each batch.

### Legal & compliance

- [ ] **LAUNCH BLOCKER**: Sign off GST rate, product HSN codes (`products.hsn_code`), shipping tax treatment (`gst_config`), and invoice format with an accountant before accepting any live orders.
- [ ] **LAUNCH BLOCKER**: Review and replace placeholder legal policies ([/privacy](/privacy), [/terms](/terms), [/shipping-returns](/shipping-returns)) with lawyer-approved text, then set `legal_pages_approved = true` (production checkout stays disabled until enabled).
- [ ] Confirm FSSAI licence number and registered address.
- [ ] Supply final Shipping, Refund & Cancellation, Privacy and Terms text (reviewed by a lawyer).
- [ ] Confirm GST registration details (GSTIN, HSN code for edible oils).
- [ ] Confirm whether DPDP Act consent banner is required at launch.

### Payments & Webhooks (Phase 6 updates)

- [ ] Create a Razorpay account and supply the live API keys (`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`) plus `PICKUP_CODE_HMAC_SECRET` in production environment secrets (never commit in code).
- [ ] Configure the Razorpay production webhook URL (`https://<api-domain>/api/webhooks/razorpay`) with the same `RAZORPAY_WEBHOOK_SECRET`, subscribing to `payment.captured`, `order.paid`, `payment.failed`, `refund.processed`, and `refund.failed`.
- [ ] Set `OWNER_ALERT_EMAIL` (and `SENTRY_DSN` in production) so critical payment/currency mismatches, late out-of-stock refunds, unexpected dashboard refunds on unshipped orders, and permanently failed worker jobs page/email an operator immediately.
- [ ] Provision **two separate Redis instances** in production: `REDIS_URL` (`volatile-lru` for cache & rate limits) and `QUEUE_REDIS_URL` (`noeviction` + AOF persistence for durable BullMQ queues & workers). Run the standalone worker process (`pnpm --filter @pressedoils/api worker:start`) alongside the API.
- [ ] Keep `ENABLE_TEMP_ADMIN_API=false` in production (the API refuses boot if enabled in prod); pre-Phase-9 manual ops scripts use CLI audit scripts.
- [ ] Review `auto_confirm_paid_orders` (defaults to `true`, automatically transitioning verified `PAID` orders to `CONFIRMED`; toggle via owner setting or `--auto-confirm=false` before Phase 9 Admin UI).
- [ ] Confirm whether to keep Cash on Delivery enabled (`cod_config`), review `cod_fee_paise` (default ₹0) and `cod_max_order_paise` (default ₹5,000), and do NOT enable COD or Pay-at-Store in production until Phase 7 SMS OTP verification is active.
- [ ] Do a small-value live test payment and refund (verifying both `refund.processed` webhook finality and manual cancel/return-stock behavior) before full launch.

### Notifications

- [ ] Set up an SMS provider account (e.g. Twilio, MSG91) and supply credentials.
- [ ] Set up a transactional email account (e.g. Resend, SendGrid) and verify the sending domain.
- [ ] Draft SMS and email templates (order confirmation, dispatch, delivery, COD confirm).

### Shipping, store pickup & serviceable pincodes

- [ ] Supply the initial list of serviceable pincodes, delivery days and COD eligibility.
- [ ] Decide whether and when to turn on promotional free shipping (`free_shipping_enabled`, threshold, optional start/end window) via owner admin setting.
- [ ] Confirm the flat shipping fee for non-free orders.
- [ ] **PICKUP BLOCKER**: Supply a real store pickup address, opening hours, and preparation time before enabling `store_pickup_enabled` in production.

### Store settings

- [ ] Supply contact phone number(s) and WhatsApp number.
- [ ] Supply contact email address.
- [ ] Supply store address for the footer and invoices.

### Admin access

- [ ] Confirm the owner admin email address for `bootstrap:prod` initial account creation (`BOOTSTRAP_ADMIN_EMAIL`).
- [ ] Log in as the owner admin on first deploy and set a strong password (`must_set_password` flag).
- [ ] Set up TOTP 2FA on the admin account before going live.

### Founder story

- [ ] Supply the founder name and the founding anecdote for the story section.
- [ ] Supply a founder quote (kept honest; no invented statistics).

### FAQ

- [ ] Supply four or more real FAQ questions and answers.

### Kitchen use cases

- [ ] Confirm or update the four kitchen-use cards (tempering, frying, pickles, festival) and their photos.

### Process section

- [ ] Supply or confirm the photo of the wooden press in action (Step 03 placeholder).
- [ ] Supply or confirm the batch labelling photo (Step 06 placeholder).

---

_This file is updated automatically at the end of each phase. Add items freely._
