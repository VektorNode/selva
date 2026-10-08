---
'@selvajs/server': minor
'@selvajs/selva': minor
---

Per-token rate limit and opt-in `Idempotency-Key` in `runHandler`.

- `@selvajs/server/api`: `runHandler` charges every API-token request to a per-token bucket (`token:{id}`) before the scope check, answers 429 `RATE_LIMITED` with `Retry-After`, and stamps `RateLimit-Limit`/`RateLimit-Remaining` on token responses. Browser sessions are not charged. Configure through `SelvaDeps.apiRateLimiter` (absent: process-wide default of 600 per 60 s; `null`: off), `createApiRateLimiter`, `resolveApiRateLimitConfig` (`API_TOKEN_RATE_LIMIT_MAX`, `API_TOKEN_RATE_LIMIT_WINDOW_MS`), or your own `ApiRateLimiter`.
- `@selvajs/server/api`: `RunHandlerOptions.idempotent` replays a repeated `Idempotency-Key` from the same token (or session user) with `Idempotency-Replayed: true`, refuses a key reused for a different method, path or body with 422, and keeps only responses below 400. `SelvaDeps.idempotency` overrides the default 5-minute in-memory store. `runIdempotent`, `idempotencyCallerId`, `readIdempotencyKey` and `requestFingerprint` serve routes that build their own response.
- `@selvajs/server/api`: new `ApiErrorCode.RATE_LIMITED`; `codeForStatus(429)` returns it. `toErrorBody` and `ApiErrorBody` now live in `errors.ts` (same exports).
- `@selvajs/selva`: compute and share-cap 429s carry `RATE_LIMITED` (the compute body moves `retryAfter` to `details.retryAfter`; the header is unchanged). Token solves also pay the per-token bucket. Project, definition, version and share-link creates opt into idempotency, and the solve route now namespaces keys per token and fingerprints the body.
