---
'@selvajs/platform': patch
'@selvajs/header-auth-provider': patch
'@selvajs/selva': patch
---

Add temporary debug logging of incoming request headers to diagnose forward-auth header forwarding on fresh deployments.

- `@selvajs/header-auth-provider`: `identifyFromHeaders` now logs every header received whenever identification fails (no UPN, disabled entry, or UPN not in the allowlist). Logs are tagged `[HeaderAuth][debug]` for easy grepping and run per-request, not once per process, so operators can compare attempts back-to-back. Exports two helpers — `dumpHeaders(headers)` and `snapshotHeaders(headers)` — so callers can reuse the same format.
- `@selvajs/selva`: the SvelteKit hook layer dumps full request headers on every `/login` miss under proxy-auth, and `/login` itself now renders a collapsible `Debug: request headers` block listing every header name and value when `hasProxyAuth` is true. This lets operators verify forward-auth wiring without server log access.
- `@selvajs/platform`: `IProxyAuth.hasNoIdentityHeaders` and `IProxyAuth.configuredHeaderNames` are no longer optional. The only implementer (`HeaderAuthProvider`) already supplied both, and making them required removes the `?.` fallbacks at the hook layer.

These are intentionally noisy and intended to be removed once header-auth deployments stabilize. Search the codebase for `[HeaderAuth][debug]` and `DEBUG (temporary, remove after deployment stabilizes)` to find every site.
