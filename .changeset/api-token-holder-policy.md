---
'@selvajs/server': minor
---

Hosts can decide who may hold API tokens. Pass `mayHoldApiTokens: (ctx) => boolean` in `depsFromConfig`'s `tokens` and to `resolveApiToken`: it replaces the `manage_api_tokens` check at mint, and the resolver re-checks it on every request against the owner's live context in the token's org, refusing with 403 `API_TOKEN_HOLDER_REFUSED` once it turns false. Without it, behaviour is unchanged. New export: `ApiTokenHolderPolicy` from `@selvajs/server/tokens`.
