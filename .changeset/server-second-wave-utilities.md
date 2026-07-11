---
'@selvajs/server': minor
'@selvajs/selva': patch
---

Second-wave reusable utilities extracted from the Selva app into `@selvajs/server` (tracker items E1–E3), each as a new subpath:

- `@selvajs/server/tokens` — `createTokenCodec({ prefix, secret })`, the HMAC capability-token primitive behind share links and invites (mint 32-byte base64url tokens, HMAC-SHA256 hash at rest, constant-time hash compare, prefix recognition). The factory enforces a ≥32-character secret so a short dev secret can't reach production silently; the app's share-link and invite token modules are now thin env bindings over one codec each.
- `@selvajs/server/errors` — `SentryErrorReporter`, the `IErrorReporter` implementation backed by a dynamically-imported `@sentry/node` (now an optional peer dependency). Literal move from the app.
- `@selvajs/server/http` — `safeRedirectTarget` (open-redirect guard), `declaredBodySizeExceeds` (transport-agnostic Content-Length guard; the app maps it to its 413), and `applySecurityHeaders` (nosniff / Referrer-Policy / Permissions-Policy / opt-in HSTS; CSP and frame headers deliberately omitted for iframe embedding — cache-control stays app policy).
- `ComputeRateLimiter` gains `peek(key)` and `clear(key)`, making it usable for failure-counting flows; the app's hand-rolled admin login rate limiter is deleted in favor of a limiter instance from this package.
