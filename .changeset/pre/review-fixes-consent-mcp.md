---
'@selvajs/server': minor
'@selvajs/mcp': minor
'@selvajs/compute': patch
'@selvajs/selva': patch
---

- **Breaking:** OAuth consent offers and mints a key only in the session's acting org. `consentOrgs` returns at most that org and `mintConsentToken` refuses any other, since the token page can list and revoke keys only there.
- `readForm` parses a request's form body once. The idempotency fingerprint and the upload handlers share it, so a definition upload is no longer buffered and parsed twice. On an idempotent route, read forms through it: `request.formData()` throws once the fingerprint has used the body.
- The CSRF exemption reads the bearer as `resolveApiToken` does, so `Bearer selva_x extra` no longer skips the Origin check.
- OAuth codes are opened with a fixed 16-byte GCM tag.
- `@selvajs/mcp` exports `refuseEarly`, the origin and key checks `handle` runs first. Selva's `/mcp` runs it against the configured origins before building a server, so neither an anonymous request nor a page on a rebound name can trigger a build.
- Step sizes count decimals at 15 significant digits: `16384.2` gets a step of 0.1, not 1e-12.
