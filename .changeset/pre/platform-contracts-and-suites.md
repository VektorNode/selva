---
'@selvajs/platform': minor
'@selvajs/local-provider': patch
'@selvajs/supabase-provider': patch
'@selvajs/server': patch
---

Interface docs now match what providers do, and the conformance suites test more of it.

- Contract docs cover `hasInstanceAdmin` and disabled users, plaintext keys at rest, `saveOrgServers` ignoring non-org entries (local now does what Supabase does), share-link reads and `revoke`, default list order, `rate_limited`, the delegated-session lifetime and the delete order.
- `DefinitionChannel` and `PlatformProjectGranteeType` derive from their schemas.
- `SupabaseAuditQuery` treats a fractional limit below 1 as 1.
- Saving a definition cover gives it a new URL, so caches don't keep the old one.
- The tarball no longer ships source maps that point at sources it doesn't include.
- `@selvajs/platform/permissions` exports `assertCanReadPermissions`, `assertCanReadPermissionsBatch` and `assertCanManagePermissions` for adapter authors, and both bundled permission stores use them.

Conformance changes for adapter authors:

- `runAuthCoreConformance` and `runPasswordAuthConformance` are new, and `runAuthProviderConformance` wraps them. Pass `passwordless` to run the core alone, and `selfRegistration` to test `registerUser`.
- `listByOrg` cases run only with `orgRoster: true`, and show as skipped otherwise instead of passing with no assertion.
- `runOrgStoreConformance` and `runProjectStoreConformance` take `seedOutsider`, and the definition scope takes `privateProjectId`, for the ctx-isolation cases.
- `runEmailLinkAuthConformance` no longer takes `validEmail`, and `sendMagicLink` on an invalid address must answer `invalid_email`.
- `removeOrgMember` on a non-member, `saveOrgServers` with a non-org entry, `markAccepted` keeping its first acceptor, and `tryIncrementSolveCount` under concurrency are now tested, along with compute key reads and `recordRun`. `delete` on an unknown grant id is no longer pinned to throw.
