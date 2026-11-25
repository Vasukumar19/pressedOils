# Operations Runbook — [YOUR BRAND]

> Living operations reference updated as infrastructure is added across phases.
> Last updated: Phase 6

---

## Health Checks & Probes

- **Liveness (`GET /api/health`)**: Confirms the Node/NestJS process is responsive (`200 OK`). Does not touch PostgreSQL or Redis.
- **Readiness (`GET /api/health/ready`)**: Executes `SELECT 1` on PostgreSQL and `PING` on Redis.
  - PostgreSQL OK + Redis OK → `200 OK` (`status: "ok"`)
  - PostgreSQL OK + Redis down/circuit open → `200 OK` (`status: "degraded"`). Do **not** pull instances out of rotation when only Redis is degraded; the API fails open to PostgreSQL with single-flight stampede protection and in-memory rate-limit fallback.
  - PostgreSQL down → `503 Service Unavailable` (`status: "down"`).

---

## Alerts to Configure

| Alert key in logs                                                                                                                        | Condition                                                                                            | Severity                          | Action                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `alert: "REDIS_DEGRADED"`                                                                                                                | Redis circuit breaker opens (3 consecutive failures or command timeout > `REDIS_COMMAND_TIMEOUT_MS`) | Warning / Page                    | Verify Redis memory (`volatile-lru`), connectivity, and latency; API continues serving from PostgreSQL.                                                      |
| `alert: "SLOW_DB_QUERY"`                                                                                                                 | PostgreSQL query duration >= `DB_SLOW_QUERY_MS` (default `200 ms`)                                   | Warning                           | Inspect query plan, verify indexes, check pool saturation (`DB_POOL_LIMIT`).                                                                                 |
| `alert: "API_SERVER_ERROR"`                                                                                                              | Unhandled `5xx` error caught by `AllExceptionsFilter`                                                | Critical                          | Correlate using `requestId` (`X-Request-Id` response header) in structured Pino logs.                                                                        |
| `alert: "PLACEHOLDER_PRODUCT_IN_PROD"`                                                                                                   | Active product in production references `/placeholders/`                                             | Critical                          | Immediately deactivate offending product in Admin / DB and investigate how it passed write guard.                                                            |
| `alert: "payment-amount-currency-mismatch"`                                                                                              | Captured Razorpay payment/webhook amount != `orders.total_paise` or currency != `INR`                | Critical (Sentry + Queue + Email) | Order is held (NEVER marked `PAID` and NOT auto-refunded). Operator reviews payment in Razorpay Dashboard vs order total and decides refund/adjust manually. |
| `alert: "unexpected-dashboard-refund"`                                                                                                   | `refund.processed` webhook arrives for an unshipped order without a prior internal `Refund` record   | Critical (Sentry + Queue + Email) | Verify physical parcel was NOT shipped; stock is NEVER auto-restored from refund webhooks. Call cancel/return-stock explicitly after physical verification.  |
| `alert: "late-payment-oos-refund-failed"` / `"admin-refund-gateway-failed"` / `"admin-cancel-refund-failed"` / `"gateway-refund-failed"` | Automatic or admin-initiated Razorpay refund failed or `refund.failed` webhook arrived               | Critical (Sentry + Queue + Email) | Retry refund in Razorpay Dashboard or `/admin/orders/:id/refund` with a fresh `Idempotency-Key`.                                                             |
| `alert: "worker-job-exhausted-*"`                                                                                                        | BullMQ worker job exhausted max backoff attempts (`5` or `3`)                                        | Critical (Sentry + Queue + Email) | Inspect failed job payload in `redis-queue` (`QUEUE_REDIS_URL`) and worker logs (`worker:start`).                                                            |

---

## Dual-Redis Policy (Cache vs Durable Queue)

- **Cache & Rate-Limit Redis (`REDIS_URL`, default `:6379`)**: Must run with `--maxmemory-policy volatile-lru`. Every cache/throttle key carries an explicit TTL.
- **Durable Queue Redis (`QUEUE_REDIS_URL`, default `:6380`)**: Must run with `--maxmemory-policy noeviction` and AOF (`--appendonly yes`). Dedicated to BullMQ queues (`orders-maintenance`, `notifications`, `ops-alerts`) so cache pressure NEVER evicts delayed retries or repeatable job state.

## Background Worker & Reconciliation (`worker:start`)

- Standalone process entrypoint: `pnpm --filter @pressedoils/api worker:start` (dev: `worker:dev`). Running jobs out-of-process avoids duplicate timers when scaling HTTP API replicas.
- Scheduled repeatable jobs (fixed scheduler IDs, exponential backoff retries, graceful `SIGINT`/`SIGTERM` shutdown):
  - `sched-reservation-expiry-1m` (`* * * * *`): Releases `PENDING` online reservations past 15m TTL + 2m grace window, ALWAYS querying Razorpay first so captured or `authorized` payments are never released.
  - `sched-reconcile-recent-2m` (`*/2 * * * *`): Reconciles `PENDING_PAYMENT` orders aged `2m–60m` against Razorpay (batches of 50 with rate-limit pauses).
  - `sched-reconcile-aging-30m` (`*/30 * * * *`): Reconciles `PENDING_PAYMENT` orders aged `1h–24h` and expires abandoned uncaptured/unauthorized orders `> 24h`.

---

## Trusted Proxy & Rate Limiting

- Always set `TRUST_PROXY` explicitly to match deployment topology (e.g. `1` behind a single load balancer, or exact proxy count/subnet). Never trust arbitrary `X-Forwarded-For` headers directly.
- Public rate limit default: `120 req/min` per client IP.
- `GET /api/pincode/:pincode`: `20 req/min` per client IP.
- `POST /api/cart/validate`: `60 req/min` per signed `X-Cart-Session` (or per IP if unauthenticated) within a `300 req/min` CG-NAT-friendly per-IP ceiling. Invalid coupon guesses cap at `10 / 15 min` per IP and per session (falls back to in-memory if Redis degrades).
- `POST /api/checkout`: `12 req/min` per session and `30 req/min` per client IP; requires a unique `Idempotency-Key` (expires after 24 hours).
- `POST /api/checkout/verify` & `POST /api/checkout/fail`: `20 req/min` per client IP.

---

## Checkout, Payments, Webhooks & Order Lifecycle

- **Gateway & webhook safety**: `APP_ENV=production` or `IS_PRODUCTION_DB=true` enforces `PAYMENT_GATEWAY=razorpay` and refuses boot unless `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `PICKUP_CODE_HMAC_SECRET`, and `QUEUE_REDIS_URL` are present, or if `PAYMENT_GATEWAY=mock`, `ALLOW_MOCK_GATEWAY=true`, or `ENABLE_TEMP_ADMIN_API=true`.
- **Webhook verification (`POST /api/webhooks/razorpay`)**: Verifies `X-Razorpay-Signature` HMAC-SHA256 over the exact raw request bytes (`401` on invalid signature) before JSON parsing, stores every verified event first in `webhook_events` (`event_id @unique`), and handles `payment.captured`, `order.paid`, `payment.failed` (keeps reservation intact until `5` failed attempts unless gateway holds `authorized`/`captured`), `refund.processed` (financial state only via cumulative `refunded_paise`; NEVER auto-restores stock), and `refund.failed`.
- **Cancellation & return stock**: Pre-shipment `/api/admin/orders/:id/cancel` is guarded by `canTransitionOrderStatus` (prevents double restock or cancelling shipped/delivered orders). Post-shipment physical returns go through `/api/admin/orders/:id/return-stock` (`SEALED_RESTOCK` increments stock vs `DAMAGED_WRITEOFF` audit-only). Temporary `/api/admin/*` endpoints are disabled cleanly (`403`) in production until Phase 9 Admin 2FA.
- **Online reservations**: Orders created with `ONLINE` payment reserve `variants.reserved` for `15 minutes` (with `2-minute` grace window). Dismissing checkout (`POST /api/checkout/fail`) requires per-order `orderToken` and never releases stock if gateway payment status is `authorized` or `captured`. Late payments when stock has sold out flag `orders.needs_attention = true` and trigger automatic gateway refunds.
- **Legal policy & COD safeguards**: `legal_pages_approved` defaults to `false` (blocking production checkout and hiding placeholder policies). `cod_config.enabled` and `store_pickup_config.payAtStoreEnabled` default to `false` in production until Phase 7 SMS OTP verification is added. `auto_confirm_paid_orders` defaults to `true` (automatically creating `CONFIRMED` after `PAID`).

---

## Swagger / OpenAPI Docs

- `APP_ENV=development`: `/api/docs` is open locally.
- `APP_ENV=staging`: `/api/docs` is gated by `SWAGGER_IP_ALLOWLIST` and/or HTTP Basic Auth (`SWAGGER_USER` + `SWAGGER_PASSWORD`). API fails to boot in staging if neither is configured.
- `APP_ENV=production`: `/api/docs` is completely disabled.
- OpenAPI spec artifact: `apps/api/openapi.json` (verified against live code on every CI run).
