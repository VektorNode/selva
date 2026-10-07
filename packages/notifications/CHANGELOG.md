# @selvajs/notifications

## 0.3.0-beta.1

### Patch Changes

- Updated dependencies [b36ac7d]
  - @selvajs/platform@0.21.0-beta.1

## 0.3.0-beta.0

### Minor Changes

- 5a96097: Create, list and revoke API tokens.

  - `@selvajs/server`: `createApiToken`, `listApiTokens` and `revokeApiToken` handlers (session-only; minting needs `manage_api_tokens`); `SelvaDeps.tokens.apiTokens`; `scopeRefusalsToday`. Every operation in the spec now documents 403 and 503.
  - `@selvajs/platform`: `describeApiScope`, and the `api_token.created` notification kind.
  - `@selvajs/notifications`: `renderApiTokenCreatedEmail`, sent to the owner when a token is minted.
  - `@selvajs/selva`: `POST`/`GET /api/v1/orgs/{orgId}/tokens`, `DELETE /api/v1/orgs/{orgId}/tokens/{tokenId}`, and an `/admin/tokens` page in the admin side nav. `settings` is now a reserved org slug.

### Patch Changes

- Updated dependencies [d50c8fa]
- Updated dependencies [5a96097]
- Updated dependencies [5a96097]
  - @selvajs/platform@0.21.0-beta.0

## 0.2.2

### Patch Changes

- Updated dependencies [3daeb50]
  - @selvajs/platform@0.20.2

## 0.2.1

### Patch Changes

- Updated dependencies [f763878]
  - @selvajs/platform@0.20.1

## 0.2.0

### Minor Changes

- 90e448d: Publish `@selvajs/notifications` to npm. `@selvajs/server` imports `renderInviteEmail` from it at runtime, so it could not stay private without making the published `@selvajs/server` tarball unresolvable.
