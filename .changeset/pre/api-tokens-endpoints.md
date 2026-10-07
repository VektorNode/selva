---
'@selvajs/platform': minor
'@selvajs/server': minor
'@selvajs/notifications': minor
'@selvajs/selva': minor
---

Create, list and revoke API tokens.

- `@selvajs/server`: `createApiToken`, `listApiTokens` and `revokeApiToken` handlers (session-only; minting needs `manage_api_tokens`); `SelvaDeps.tokens.apiTokens`; `scopeRefusalsToday`. Every operation in the spec now documents 403 and 503.
- `@selvajs/platform`: `describeApiScope`, and the `api_token.created` notification kind.
- `@selvajs/notifications`: `renderApiTokenCreatedEmail`, sent to the owner when a token is minted.
- `@selvajs/selva`: `POST`/`GET /api/v1/orgs/{orgId}/tokens`, `DELETE /api/v1/orgs/{orgId}/tokens/{tokenId}`, and an `/admin/tokens` page in the admin side nav. `settings` is now a reserved org slug.
