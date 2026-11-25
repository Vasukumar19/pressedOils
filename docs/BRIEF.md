# [YOUR BRAND] — Project Brief

> **This file is the canonical project brief. Every AI session and every contributor should read it
> before making any change. It is intentionally complete and long.**
>
> Last updated: Phase 0

---

## What we are building

A production e-commerce platform for **[YOUR BRAND]**, an Indian single-brand store selling
cold-pressed / wood-pressed cooking oils. One seller (the owner). No marketplace.

---

## Target architecture

```
repo root (pnpm + Turborepo monorepo)
├── apps/web      Next.js 16 storefront (Vercel, Mumbai region)
├── apps/admin    Next.js owner dashboard (separate deployment)
├── apps/api      NestJS REST API (Railway / Render, Mumbai)
└── packages/shared  Zod schemas, TypeScript types, enums, constants
```

---

## Default decisions (change only with explicit approval)

| Concern       | Decision                                                                     |
| ------------- | ---------------------------------------------------------------------------- |
| Payments      | Razorpay (UPI, cards, net banking) + Cash on Delivery                        |
| Shipping      | Manual dispatch first; courier API (Shiprocket / Delhivery) pluggable later  |
| Notifications | SMS + email at launch; WhatsApp later                                        |
| Currency      | INR; amounts always in **paise (integer)**; never floats for money           |
| Hosting       | Storefront → Vercel Mumbai; API + DB + Redis → AWS / Railway / Render Mumbai |
| Test runner   | Vitest everywhere; Jest for apps/api only if Vitest + unplugin-swc fails     |
| Node          | 22.x (pinned in .nvmrc and engines)                                          |
| pnpm          | 12.3.4 (pinned in packageManager and CI)                                     |

---

## Six placeholder products (dev & staging only)

> Sample products and placeholder images live in `apps/api/prisma/seed.dev.ts` and `apps/web/public/placeholders/` **only** for development and staging. They **never** go into the production database, and the production web build must not serve `/placeholders/`.
>
> - `seed:dev`: creates the six sample products and placeholder images (refuses to run when `NODE_ENV=production` or when `DATABASE_URL` / `IS_PRODUCTION_DB` indicates production).
> - `bootstrap:prod`: creates only the first owner admin account (owner sets password on first login), default settings, and empty product tables.
> - Production activation rule: API refuses `is_active = true` unless the product has a real non-`/placeholders/` image, price > 0, stock set, and an assigned active batch.

1. Groundnut Oil
2. White Sesame Oil
3. Black Sesame Oil
4. Sunflower Oil
5. Safflower Oil
6. Coconut Oil

Each has 3 variants: 500 ml, 1 L, 5 L — with clearly fake placeholder prices (₹100 / ₹200 / ₹900)
and placeholder stock (50 units).

---

## Data model (PostgreSQL / Prisma)

See the full schema specification in `docs/BRIEF.md` (this file, section below).

### Tables

| Table                  | Key columns                                                                                                                                                                                                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `products`             | id, slug, name, description, best_for, origin_region, is_active, sort_order, brand                                                                                                                                                                                                   |
| `product_images`       | id, product_id, url, alt, sort_order                                                                                                                                                                                                                                                 |
| `variants`             | id, product_id, sku, size_label, price_paise, mrp_paise, stock, reserved, low_stock_threshold, is_active                                                                                                                                                                             |
| `batches`              | id, product_id (required, RESTRICT), variant_id (optional, RESTRICT), batch_no (unique per product), pressed_on (Date), best_before (Date), lab_report_url, lab_report_key, lab_report_checksum, lab_tested_on (Date), is_current (partial unique per product), is_active, locked_at |
| `customers`            | id, name, phone (unique), email, created_at                                                                                                                                                                                                                                          |
| `addresses`            | id, customer_id, name, phone, line1, line2, city, state, pincode                                                                                                                                                                                                                     |
| `orders`               | id, order_number (human-readable, unique), customer_id, address snapshot, subtotal_paise, shipping_paise, discount_paise, tax_paise, total_paise, payment_method, payment_status, order_status, created_at                                                                           |
| `order_items`          | id, order_id, variant_id, batch_id, product_name_snapshot, size_snapshot, qty, unit_price_paise                                                                                                                                                                                      |
| `order_events`         | id, order_id, status, note, actor, created_at                                                                                                                                                                                                                                        |
| `payments`             | id, order_id, gateway, gateway_order_id, gateway_payment_id (unique), amount_paise, status, raw_payload, created_at                                                                                                                                                                  |
| `stock_movements`      | id, variant_id, delta, reason, order_id (nullable), actor, created_at                                                                                                                                                                                                                |
| `reservations`         | id, order_id, variant_id, qty, expires_at, status                                                                                                                                                                                                                                    |
| `coupons`              | id, code (unique), type (percent/flat), value, min_order_paise, expires_at, usage_limit, used_count, is_active                                                                                                                                                                       |
| `serviceable_pincodes` | pincode, city, state, delivery_days, cod_allowed, shipping_paise                                                                                                                                                                                                                     |
| `settings`             | key, value                                                                                                                                                                                                                                                                           |
| `admins`               | id, email, password_hash, role, totp_secret, is_active                                                                                                                                                                                                                               |
| `audit_logs`           | id, admin_id, action, entity, entity_id, before, after, created_at                                                                                                                                                                                                                   |

### Order status flow

```
PENDING_PAYMENT → PAID (or COD_PENDING) → CONFIRMED → PACKED → SHIPPED → DELIVERED
                                        ↘ CANCELLED
                                          REFUNDED
```

Every transition writes an `order_events` row and enqueues a notification.

---

## Security rules (non-negotiable)

- Never trust the client for prices, totals, discounts or stock — recalculate server-side.
- Confirm payment only from the Razorpay webhook after signature verification.
- Webhook handlers must be idempotent (keyed by `gateway_payment_id`).
- Stock reserved at checkout with 15-minute expiry; converted to sold on capture; released on failure.
- Write a `stock_movements` row for every stock change.
- Store no card data; Razorpay handles PCI scope.
- Validate all input with Zod on every endpoint. Rate-limit login, OTP, checkout and tracking.
- HTTPS only, secure headers, CORS allowlist, CSRF protection where cookies are used.
- Admin: argon2/bcrypt hashed passwords + TOTP 2FA; roles (owner, staff); audit log.
- Customer data: collect only what's needed; consent and privacy policy (India DPDP Act).

---

## Engineering standards

- TypeScript strict mode, ESLint, Prettier, Husky pre-commit, conventional commits.
- Database changes via Prisma migrations only (PostgreSQL 16).
  - Production runs **only** `prisma migrate deploy` (never `migrate dev` or `db push`).
  - Migrations are forward-only and backward-compatible with the previous app version (add first, switch code, remove later).
  - Take a verified backup before every production migration; run migrations as a single, locked deploy step.
- Automated tests required for every money or stock path before a phase is "done".
- Animations: respect `prefers-reduced-motion`; lazy-load GSAP and heavy components; show entrance
  curtain once per session; never block content or SEO.
- Accessibility: semantic HTML, keyboard navigation, 44 px tap targets, visible focus, alt text.
- No invented facts: no fake reviews, ratings, certifications, lab results or statistics.
- Ask before making any decision not covered in this brief.

---

## Design consistency rules (applies to every phase)

### 1. Reuse before create

Inspect existing components, Tailwind theme variables, shadcn/ui components and global styles first.
Only create new components if nothing existing fits.

### 2. Fonts

- **Headings:** Cormorant Garamond (weights 300–600, normal and italic)
- **Body / UI:** Inter
- **No new families. No new weights.** (Native names and regional script fonts were removed.)

### 3. Colours and tokens

Only use the existing named tokens (see `lib/tokens.ts` and `app/globals.css`):
forest, gold, bronze, ivory, champagne, sand, ink, sage, error, error-bg, success, success-bg.
No hard-coded hex values. Gold is an accent, not a large fill.

### 4. Look and feel

Luxury, editorial, calm: generous spacing, thin hairlines, soft rounding, minimal ornament.
Forms, tables, modals, drawers and toasts use shadcn/ui styled with project tokens.
Glass blur (`backdrop-blur`) only on the header and cart drawer.

### 5. Motion

- GSAP for scroll-triggered scenes
- Motion (Framer) for small UI interactions
- No third animation library
- Timing: ~500–900 ms for large reveals; shorter for UI feedback
- Always respect `prefers-reduced-motion`; keep mobile motion light

### 6. Admin app

Denser and more functional but same fonts, colours and tokens. Clarity over decoration.
No heavy animation in admin.

### 7. Emails and documents

Brand colours, heading serif (with safe fallback), clean layout, logo.

### 8. Responsive and accessible

Every new screen works from 360 px wide. 44 px tap targets, visible focus, good contrast.

### 9. Design consistency check (required in every phase summary)

List: new UI elements added / existing components and tokens reused / confirm no new fonts,
colours or styles were introduced. If something new was added, explain why.

---

## Phases

| #   | Name                            | Done when                                                                          |
| --- | ------------------------------- | ---------------------------------------------------------------------------------- |
| 0   | Audit & monorepo                | Web builds, CI is green, no visual change                                          |
| 1   | Database, seed & shared schemas | `migrate + seed` works from scratch                                                |
| 2   | Public API                      | Endpoints documented (OpenAPI) and tested                                          |
| 3   | Connect storefront to real data | Price change in DB changes site, no code edits                                     |
| 4   | Cart                            | Tampering localStorage prices has no effect                                        |
| 5   | Checkout                        | Test payments pass/fail correctly; stock reserved/released                         |
| 6   | Payment webhook, orders & stock | Replaying webhook twice → no change; concurrency test passes                       |
| 7   | Notifications                   | Every status change sends exactly one notification in test mode                    |
| 8   | Track Order & account           | —                                                                                  |
| 9   | Admin app                       | All six placeholder products replaceable from admin UI alone                       |
| 10  | Trust features                  | Batch lookup live; reviews from verified buyers only                               |
| 11  | SEO, performance, accessibility | Core Web Vitals green; axe audit clean                                             |
| 12  | Testing                         | All test suites pass; load test, security review done                              |
| 13  | Deployment & operations         | CI/CD, backups, Sentry, uptime monitoring                                          |
| 14  | Launch checklist                | Go/no-go checklist signed off by owner (incl. accountant GST/HSN/invoice sign-off) |

---

## Working style

- Begin each phase with a short plan and list any questions.
- Keep commits small. Explain risky changes.
- Never skip tests for money and stock logic.
- Leave clearly marked `TODO(owner):` placeholders and add them to `docs/OWNER_TODO.md`.
- Stop after each phase and wait for "go" before starting the next.
