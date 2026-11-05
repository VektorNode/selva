---
'@selvajs/platform': major
---

1.0: API tokens, delegated sessions, a declared config surface, and a cleaned-up provider contract.

**Breaking (adapters and direct consumers)**

- `IStorageProvider.put` returns the path it stored at (images are rewritten to `.webp`). `IInviteStore.markAccepted` returns whether this call accepted the invite.
- `removeOrgMember` throws 404 for a non-member; `deletePrefix` refuses an empty prefix and `/`. The conformance suites assert both.
- Removed: `IOAuthAuth.refreshSession` (use `auth.sessionRefresh?.refreshSession`), `orgPaths.privateAsset`, the `org` value of `AssetVisibility` / `AssetScope`, `orgServersFor`, `isPublicAssetPath`, `COVER_IMAGE_EXTENSIONS`, `ALLOWED_UPLOAD_EXTENSIONS`, `DefinitionVersionSchema`, `DefinitionFileExtSchema`.
- No longer exported: `IMAGE_MAX_WIDTH`, `IMAGE_WEBP_QUALITY`, `isImageUpload`, `toWebpPath`, the asset-class types, `CreateOrgInput`, `UpdateOrgInput`, `DefinitionChannelSchema`, `UUID_REGEX`, the platform-project grant schemas, `AuditUpdate`, `AuditSoftDelete`. Secret crypto lives on `@selvajs/platform/computeServer` only.
- Conformance: `runEmailLinkAuthConformance` drops `validEmail`; `listByOrg` cases need `orgRoster: true`; org/project suites take `seedOutsider`.
- `RESERVED_SLUGS` adds `docs`, `mcp` and `oauth`. `GuidSchema` lowercases.

**Added**

- API tokens: `ApiToken`, optional `IApiTokenStore` on `IDataProvider`, `scopeAllows`, `apiScopeActionCovers`, `narrowApiTokenContext`, `outsideTokenOrg`, `describeApiScope`, `ctx.apiScope`, the `manage_api_tokens` permission, `api_token.*` events and notification kind, and `actorOf` (events record `tokenId`).
- `IAuthProvider.delegatedSession` for running a token request under the owner's row security.
- `@selvajs/platform/config`: every env var declared once with type, default and boot effect; `resolveConfig`, `buildConfigReport`, `defineConfig`.
- `encryptSecret` / `decryptSecret` take `aad` (`enc:v2:` envelopes); `v1` still reads.
- `IDefinitionStore.getDefinitionsFor` and `listVersionsFor` batch reads; `walkPages`, `listAll`, cursor helpers, `pickServer`, `orgSlugFromName`, `canCreateDefinition`, `sourceDocumentId` on definitions.
- `ErrorContext.level` and `kind`; new conformance suites for auth core, password, OAuth and audit queries.

**Fixed**

- Image transcoding refuses more than 60 MP, times out after 10 s, runs two at a time and checks the real format (422, not 500). Stored images honour EXIF orientation and fit 1200 px on both sides. A declared content type beats the extension.
- Access rules: commons uploads need `canView`; platform projects can't be edited with `ENABLE_PLATFORM_PROJECTS` off; share-link contexts have no permissions; null projects are refused.
- The solve-metric buffer can't grow past `maxBufferSize`. SMTP failures log a code and a hashed recipient. `slugify` folds accents. Names of only spaces are refused. `sideEffects: false`, and `instanceof ProviderError` works across copies.
