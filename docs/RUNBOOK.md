# Operations Runbook — [YOUR BRAND]

> Living operations reference updated as infrastructure is added across phases.
> Last updated: Phase 2

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

---

## Swagger / OpenAPI Docs

- `APP_ENV=development`: `/api/docs` is open locally.
- `APP_ENV=staging`: `/api/docs` is gated by `SWAGGER_IP_ALLOWLIST` and/or HTTP Basic Auth (`SWAGGER_USER` + `SWAGGER_PASSWORD`). API fails to boot in staging if neither is configured.
- `APP_ENV=production`: `/api/docs` is completely disabled.
- OpenAPI spec artifact: `apps/api/openapi.json` (verified against live code on every CI run).
