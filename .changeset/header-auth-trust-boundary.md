---
'@selvajs/header-auth-provider': minor
---

Stop rewriting a stored UPN from request headers, and detect a non-stripping proxy.

`identifyFromHeaders` no longer calls `rebindUpn` after an email-fallback match. Both
headers on that path are proxy-supplied, so the rebind let one request repoint an
existing allowlist row's lookup key at a caller-supplied UPN — impersonation became
persistence, and a `.catch(() => {})` hid any failure. The fallback still adopts the
matched row, so Entra deployments where the UPN differs from the mail address keep
working; they resolve by email on each login rather than being rewritten after the
first. `rebindUpn` remains on `AllowlistStore` for operator-driven correction.

A UPN header carrying more than one value is now refused with a warning that names the
cause. `Headers.get()` joins repeats with `", "`, which is what a proxy that fails to
strip client-supplied copies produces. Such a request never matched an allowlist row
anyway, so no working login changes — the warning replaces a failure that was
indistinguishable from "user not allowlisted". The check applies to the UPN header
only: display names legitimately contain commas.
