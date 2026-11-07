---
'@selvajs/supabase-provider': minor
'@selvajs/local-provider': patch
'@selvajs/server': patch
'@selvajs/platform': patch
---

Store fixes across both providers:

- `markAccepted` refuses an expired invite.
- A share link stops counting solves once its definition is deleted. On Supabase this is a new migration: run `npx selva-supabase` and `supabase db push`.
- Supabase emits `definition.deleted` only when a row was deleted, and `listUsers` and the audit query clamp their limit (`limit: 0` returns one row; the audit default is now 50).
- Local's `revoke` of an unknown share link is a 404, and local storage refuses a bad path with `ProviderError` 400.
- Supabase has no platform-project grants, so provider setup now fails when `ENABLE_PLATFORM_PROJECTS` is on. `IPlatformProjectGrantStore` gains an optional `unsupported` marker.
