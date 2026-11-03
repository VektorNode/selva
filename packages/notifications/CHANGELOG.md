# @selvajs/notifications

## 0.3.0-beta.10

### Patch Changes

- Updated dependencies [95dbab4]
  - @selvajs/platform@1.0.0-beta.10

## 0.3.0-beta.9

### Patch Changes

- Updated dependencies [94692f5]
  - @selvajs/platform@1.0.0-beta.9

## 0.3.0-beta.8

### Patch Changes

- Updated dependencies [3ba8225]
  - @selvajs/platform@1.0.0-beta.8

## 0.3.0-beta.7

### Patch Changes

- Updated dependencies [a409b68]
  - @selvajs/platform@1.0.0-beta.7

## 0.3.0-beta.6

### Patch Changes

- Updated dependencies [5a42d64]
  - @selvajs/platform@1.0.0-beta.6

## 0.3.0-beta.5

### Patch Changes

- Updated dependencies [a7c12ee]
  - @selvajs/platform@1.0.0-beta.5

## 0.3.0-beta.4

### Patch Changes

- Updated dependencies [b6935ce]
- Updated dependencies [817af19]
- Updated dependencies [cc081b1]
- Updated dependencies [eebd2f6]
- Updated dependencies [35e5c67]
- Updated dependencies [77780c7]
- Updated dependencies [5ab63df]
- Updated dependencies [ff7e2a0]
- Updated dependencies [1fb3914]
  - @selvajs/platform@1.0.0-beta.4

## 0.3.0-beta.3

### Patch Changes

- Updated dependencies [65786d5]
  - @selvajs/platform@0.21.0-beta.3

## 0.3.0-beta.2

### Patch Changes

- Updated dependencies [ef94b55]
  - @selvajs/platform@0.21.0-beta.2

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
