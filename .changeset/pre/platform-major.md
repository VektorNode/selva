---
'@selvajs/platform': major
'@selvajs/server': major
'@selvajs/local-provider': minor
'@selvajs/supabase-provider': minor
'@selvajs/selva': patch
---

A clean-up major for the platform contract. Adapters and direct consumers need the changes below. No behaviour changes for an app that only uses the routes.

Changed signatures:

- `IStorageProvider.put` returns the path it stored at, since images are rewritten to `.webp`. An adapter has to return it; a caller can use it instead of guessing.
- `IInviteStore.markAccepted` returns `true` when this call accepted the invite and `false` when it was already accepted or is gone.

Removed:

- `IOAuthAuth.refreshSession`. Use `auth.sessionRefresh?.refreshSession(...)`.
- `orgPaths.privateAsset`, `requireCanViewOrg` from `@selvajs/server`, and the `org` value of `AssetVisibility` and `AssetScope`. No asset class serves those paths.
- `orgServersFor`, `isPublicAssetPath`, `COVER_IMAGE_EXTENSIONS`, `ALLOWED_UPLOAD_EXTENSIONS`, `DefinitionVersionSchema` and `DefinitionFileExtSchema`, which nothing used.

No longer exported, though still used inside the package: `ApiTokenRevokeReasonSchema`, `IMAGE_MAX_WIDTH`, `IMAGE_WEBP_QUALITY`, `isImageUpload`, `toWebpPath`, `AssetVisibility`, `AssetScope`, `AssetClass`, `AssetMatch`, `ALL_ORG_ASSET_KINDS`, `CreateOrgInput`, `UpdateOrgInput`, `DefinitionChannelSchema`, `UUID_REGEX`, `PlatformProjectGrantSchema`, `PlatformProjectGranteeTypeSchema`, `PlatformProjectGranteeType`, `AuditUpdate` and `AuditSoftDelete`.

The root barrel now re-exports each area with `export *`, so a new export reaches it without a second edit. Secret crypto stays out of it, on `@selvajs/platform/computeServer`. `OPERATOR_PLATFORM_PERMISSIONS` is also on `@selvajs/platform/permissions`.
