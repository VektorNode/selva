---
'@selvajs/platform': minor
'@selvajs/server': minor
'@selvajs/local-provider': minor
'@selvajs/supabase-provider': patch
'@selvajs/selva': minor
---

API tokens, resolution and enforcement (no minting UI yet).

- `@selvajs/platform`: `ApiToken`, `IApiTokenStore` (optional `apiTokens` on `IDataProvider`), `scopeAllows`, `narrowApiTokenContext`, `apiScope` on `RequestContext`, the `manage_api_tokens` and `read_all_org_projects` permissions, `api_token.*` events, and `actorOf`, which adds `tokenId` to events written during a token request. `read_all_org_projects` is not in the owner/admin defaults.
- `@selvajs/server`: `resolveApiToken` and `buildRequestContext` in `/http`; `createApiTokenCodec` (`selva_` keys with a checksum) in `/tokens`; `runHandler` checks API-token scopes, with `action` and `scopeTarget` options; `ApiError` gains `details`; new code `API_TOKENS_UNAVAILABLE`.
- `@selvajs/local-provider`: `LocalApiTokenStore`, wired into the org-delete cascade and user erasure.
- `@selvajs/selva`: the hook resolves `Authorization: Bearer selva_…` on `/api/v1/*` before the cookie, and a bad key never falls back to the session.
