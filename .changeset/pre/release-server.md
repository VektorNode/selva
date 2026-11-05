---
'@selvajs/server': major
---

API tokens, an OAuth server for MCP clients, rate limiting and idempotency in `runHandler`, and telemetry seams.

**Breaking**

- `@selvajs/server/compute` no longer exports `idempotencyKey`, `toStoredResponse`, `fromStoredResponse`, `IDEMPOTENCY_REPLAYED_HEADER` or `StoredResponse`. Idempotency lives in `/api` (`RunHandlerOptions.idempotent`, `runIdempotent`, `requestFingerprint(url)`).
- `requireCanViewOrg` is removed. `ComputeLimits` drops `solveDeadlineMs` and `computeReuseDefinitionCache`; `COMPUTE_SOLVE_DEADLINE_MS` and `COMPUTE_CACHE_ERRORED_SOLVES` are no longer read, and the request cap is a fixed 256 MB. Requires `@selvajs/solve` 2.
- `parseBody` answers broken JSON with 400 (only an empty body falls back to `missingAs`); `readForm` answers a non-form body with 400 and parses it once, so read forms through it on idempotent routes.
- Changing or removing org members needs a browser session. Only the org owner changes an owner's or admin's permissions.
- `validateIncomingServers` refuses non-UUID or repeated ids, `timeoutMs` outside 1000 to 300000, `retryCount` outside 0 to 5, and envelope-shaped `apiKey`s. A save that omits an undecryptable key answers 409.
- Share links get a 90-day default expiry.
- New `assertKeyNotRetargeted`: a compute save that changes a server's URL must re-enter or clear its key (409). `updateOrgCompute` needs a browser session.

**Added**

- API tokens: `resolveApiToken`, `buildRequestContext`, `createApiTokenCodec`, token handlers (create, list, revoke, revoke own, `revokeUserApiTokens`), holder policy (`mayHoldApiTokens`, `canHoldApiTokens`), resolution and holder-verdict caches, `signInMaxAgeMs` / `SIGN_IN_MAX_AGE_DAYS`, `signInWindowMs` / `API_TOKEN_SIGN_IN_WINDOW_DAYS`, `create_projects` and `upload` actions, and `/me` reporting the key.
- `runHandler`: API-token scope checks, per-token rate limit (`createApiRateLimiter`, 429 `RATE_LIMITED` with `Retry-After` and `RateLimit-*`), `idempotent`, `anyScope`, `Retry-After` from `details.retryAfter`. `ApiError` gains `details`.
- `@selvajs/server/oauth`: OAuth 2.1 authorization server issuing API tokens, with DCR, Client ID Metadata Documents and the built-in `selva-grasshopper` client.
- `buildOpenApiDocument` and `Endpoint` (`scope` required, emitted as `x-scope`; `longRunning` as `x-long-running`).
- `/http`: `isCrossSiteFormSubmission`, `createSessionResolver`, `createSessionRefresher`, `createRequestMemo`, `createBoundedTtlCache`, `createRequestTiming`. `/compute`: `createServerResolver`. `/projects`: `deleteProjectWithBlobs`, `deleteOrgWithBlobs`. `/definitions`: `isUsableCachedSchema`.
- `/errors`: `scrubEvent`, `scrubBreadcrumb`, `withoutQuery`, `sampleRate`; `SentryErrorReporter.create` installs them and takes `tracesSampleRate`, and `fromClient` wraps a host's SDK.
- `/config`: this package's env slice.

**Fixed**

- Invite resend runs the same gates as creation; invites can't be created with an API key; member changes in one org are serialized so two owners can't leave none.
- `safeRedirectTarget` refuses control characters. Cover images are type-checked before writing. `POST /api/v1/compute/schema` answers 401/403/404 instead of 500.
- Definition loads resolve the compute server in parallel. Sentry spans run through the scrubber (`traceLifecycle: 'static'`).
