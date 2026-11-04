---
'@selvajs/platform': minor
'@selvajs/supabase-provider': patch
'@selvajs/server': patch
'@selvajs/selva': patch
---

Smaller fixes across the platform package and its consumers.

- The solve-metric cap now counts batches waiting to be written, so a hung backend can't grow memory past `maxBufferSize`, and dropped rows are logged.
- `@selvajs/platform` declares `sideEffects: false` and no longer names `sharp` statically, so the root barrel bundles for the browser. `instanceof ProviderError` works across two installed copies.
- SMTP failures log an error code and a keyed hash of the recipient instead of the address and the raw server message, and `SendResult.reason` carries the code.
- `scopeConfigToOrg` drops an org default the org can't see.
- `decodeSecretKey` trims whitespace and refuses junk-padded input or a passphrase that isn't really base64.
- `slugify` folds accents and never ends in a hyphen. A renamed project with no usable letters keeps its slug. New `orgSlugFromName` moves an org off a reserved word, and setup and bootstrap use it.
- `RESERVED_SLUGS` now matches the route tree: `docs`, `mcp` and `oauth` are in, `settings` is out, and a test holds it there.
- Org and definition names are trimmed, so a name of only spaces is refused.
- `withCacheBust` puts the token before a fragment.
- Session refresh uses `auth.sessionRefresh` first, so a provider without OAuth is refreshed too.
- `canEdit`, `canManage` and `canEditProjectSettings` refuse a null project, `canEditDefinition` checks the definition belongs to the project, and `canView` on an `org` project requires acting as that org.
