# Operations Runbook — [YOUR BRAND]

> Living operations reference updated as infrastructure is added across phases.
> Last updated: Phase 5

---

## Health Checks & Probes

- **Liveness (`GET /api/health`)**: Confirms the Node/NestJS process is responsive (`200 OK`). Does not touch PostgreSQL or Redis.
- **Readiness (`GET /api/health/ready`)**: Executes `SELECT 1` on PostgreSQL and `PING` on Redis.
  - PostgreSQL OK + Redis OK → `200 OK` (`status: "ok"`)
  - PostgreSQL OK + Redis down/circuit open → `200 OK` (`status: "degraded"`). Do **not** pull instances out of rotation when only Redis is degraded; the API fails open to PostgreSQL with single-flight stampede protection and in-memory rate-limit fallback.
  - PostgreSQL down → `503 Service Unavailable` (`status: "down"`).

---

## Alerts to Configure

| Alert key in logs                      | Condition                                                                                            | Severity       | Action                                                                                                  |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------- |
| `alert: "REDIS_DEGRADED"`              | Redis circuit breaker opens (3 consecutive failures or command timeout > `REDIS_COMMAND_TIMEOUT_MS`) | Warning / Page | Verify Redis memory (`volatile-lru`), connectivity, and latency; API continues serving from PostgreSQL. |
| `alert: "SLOW_DB_QUERY"`               | PostgreSQL query duration >= `DB_SLOW_QUERY_MS` (default `200 ms`)                                   | Warning        | Inspect query plan, verify indexes, check pool saturation (`DB_POOL_LIMIT`).                            |
| `alert: "API_SERVER_ERROR"`            | Unhandled `5xx` error caught by `AllExceptionsFilter`                                                | Critical       | Correlate using `requestId` (`X-Request-Id` response header) in structured Pino logs.                   |
| `alert: "PLACEHOLDER_PRODUCT_IN_PROD"` | Active product in production references `/placeholders/`                                             | Critical       | Immediately deactivate offending product in Admin / DB and investigate how it passed write guard.       |

---

## Redis Policy

- Redis must run with `--maxmemory-policy volatile-lru`.
- Every cache and rate-limit key written by the API carries an explicit TTL so memory pressure evicts cache entries smoothly without unbounded growth.

---

## Trusted Proxy & Rate Limiting

- Always set `TRUST_PROXY` explicitly to match deployment topology (e.g. `1` behind a single load balancer, or exact proxy count/subnet). Never trust arbitrary `X-Forwarded-For` headers directly.
- Public rate limit default: `120 req/min` per client IP.
- `GET /api/pincode/:pincode`: `20 req/min` per client IP.
- `POST /api/cart/validate`: `60 req/min` per signed `X-Cart-Session` (or per IP if unauthenticated) within a `300 req/min` CG-NAT-friendly per-IP ceiling. Invalid coupon guesses cap at `10 / 15 min` per IP and per session (falls back to in-memory if Redis degrades).
- `POST /api/checkout`: `12 req/min` per session and `30 req/min` per client IP; requires a unique `Idempotency-Key` (expires after 24 hours).
- `POST /api/checkout/verify` & `POST /api/checkout/fail`: `20 req/min` per client IP.

---

## Checkout, Payments & Reservations

- **Gateway safety**: `APP_ENV=production` or `IS_PRODUCTION_DB=true` enforces `PAYMENT_GATEWAY=razorpay` and refuses boot if `PAYMENT_GATEWAY=mock` or `ALLOW_MOCK_GATEWAY=true`, or if `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, or `PICKUP_CODE_HMAC_SECRET` are missing.
- **Online reservations**: Orders created with `ONLINE` payment reserve `variants.reserved` for `15 minutes` (with `2-minute` grace window). Before expiring an unpaid order, the expiry sweeper checks Razorpay payment status so completed payments still confirm via `markOrderPaid`. Late payments when stock has already sold out flag `orders.needs_attention = true` and trigger automatic gateway refunds.
- **Legal policy & COD safeguards**: `legal_pages_approved` defaults to `false` (blocking production checkout and hiding placeholder policies). `cod_config.enabled` and `store_pickup_config.payAtStoreEnabled` default to `false` in production until Phase 7 SMS OTP verification is added.

---

## Swagger / OpenAPI Docs

- `APP_ENV=development`: `/api/docs` is open locally.
- `APP_ENV=staging`: `/api/docs` is gated by `SWAGGER_IP_ALLOWLIST` and/or HTTP Basic Auth (`SWAGGER_USER` + `SWAGGER_PASSWORD`). API fails to boot in staging if neither is configured.
- `APP_ENV=production`: `/api/docs` is completely disabled.
- OpenAPI spec artifact: `apps/api/openapi.json` (verified against live code on every CI run).
