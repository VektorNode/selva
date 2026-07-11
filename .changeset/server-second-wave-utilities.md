---
'@selvajs/server': minor
'@selvajs/selva': patch
---

Second-wave reusable utilities extracted from the Selva app into `@selvajs/server` (tracker items E1–E6), each as a new subpath:

- `@selvajs/server/tokens` — `createTokenCodec({ prefix, secret })`, the HMAC capability-token primitive behind share links and invites (mint 32-byte base64url tokens, HMAC-SHA256 hash at rest, constant-time hash compare, prefix recognition). The factory enforces a ≥32-character secret so a short dev secret can't reach production silently; the app's share-link and invite token modules are now thin env bindings over one codec each.
- `@selvajs/server/errors` — `SentryErrorReporter`, the `IErrorReporter` implementation backed by a dynamically-imported `@sentry/node` (now an optional peer dependency). Literal move from the app.
- `@selvajs/server/http` — `safeRedirectTarget` (open-redirect guard), `declaredBodySizeExceeds` (transport-agnostic Content-Length guard; the app maps it to its 413), `applySecurityHeaders` (nosniff / Referrer-Policy / Permissions-Policy / opt-in HSTS; CSP and frame headers deliberately omitted for iframe embedding — cache-control stays app policy), and `createRouteClassifier` (deny-by-default route classification: exact public pages, public prefixes, public APIs, one self-gating prefix, static assets — the app supplies its route values).
- `@selvajs/server/access` — `createProjectAccessInputBuilder(deps)`, the marshalling layer between an app's providers and platform's pure access rules: it owns the "which rows does each project visibility need" knowledge (`platform`→grants, `private`→member, `org`/`public`→member+orgMember with the cross-org-public skip) plus the zero-I/O `projectAccessInputFromRows` for batched listing pages. Row lookups and flag reads are injected as functions.
- `@selvajs/server/ops` — channel-aware `parseSemver`/`isNewer` (stable ignores pre-release tails; beta orders `-beta.N` and ranks a stable core above its betas) and the `ReleaseChannel` type.
- `ComputeRateLimiter` gains `peek(key)` and `clear(key)`, making it usable for failure-counting flows; the app's hand-rolled admin login rate limiter is deleted in favor of a limiter instance from this package.
