# `@selvajs/platform` review: source and tests

> **Tracked in:** unfiled. Review of `packages/platform`, plus the provider and consumer code each
> finding depends on. Checked against the tree in
> [platform-review-validation](./platform-review-validation.md); read that alongside this one.
> Line numbers drift: when one stops resolving, grep the quoted text.

## Ground rules

- `@selvajs/platform` is published and has a consumer outside this monorepo. Removing a public
  export is a major bump, so [Public API candidates](#public-api-candidates) are listed apart from
  the fixes that leave the API alone.
- The package is mostly interfaces. Its risk sits in the small amount of real logic (access rules,
  scopes, secrets, slugs, asset classes) and in what the interface docs promise, because two
  providers implement them and neither is the reference.
- A test earns its place only if it exercises a case a caller or provider can hit, and its
  assertion fails when that behaviour breaks.

## Bugs in platform logic

- **B1. `canCreateDefinition` skips reach.** `access/rules.ts:141` returns true on
  `autoJoinOnUpload === true` without `canView`. With `ALLOW_CROSS_ORG_PUBLIC=false`, a user from
  another org can upload into a commons project. `requireCanCreateDefinition` adds no tenancy
  check. Fix: `(autoJoinOnUpload && canView(input)) || canEdit(input)`.
- **B2. `hasPermission` passes share contexts.** `context.ts:63` returns true for any `ctx.system`,
  and the share context is built with `system: true`, so an anonymous token holder passes
  `hasPermission(ctx, 'instance_admin')`. No route passes a share context there today, so it is
  latent. Fix: `ctx.system && !isShareContext(ctx)`.
- **B3. `scopeConfigToOrg` keeps a hidden default.** `computeServer/utils.ts:98-108` keeps
  `orgDefaults[orgId]` after the server stops being visible. `server/src/handlers/orgCompute.ts:78`
  and `selva/src/routes/team/compute/+page.server.ts:69` read it directly; `defaultServerIdFor`
  filters it. Fix: keep the entry only if it is in `visibleIds`.
- **B4. `decodeSecretKey` misreports a trailing newline.** `computeServer/secrets.ts:63`: a 64-char
  hex key plus `\n` fails the hex regex, base64-decodes to 48 bytes and throws "must be 32 bytes".
  Fix: trim first.
- **B5. `slugify` output can fail `SlugSchema`.** `organizations/schemas.ts:44-53` slices to 63
  after trimming hyphens, so `slugify('a'.repeat(62)+' b')` ends in `-`. Non-ASCII letters turn into
  hyphens (`Müller GmbH` → `m-ller-gmbh`, `日本` → `''`).
- **B6. `SlugSchema` message and comment are wrong.** `schemas.ts:65-72`: the message says no
  consecutive hyphens but `a--b` passes. The case-insensitive comment describes the refine, while
  the regex already rejects uppercase.
- **B7. `RESERVED_SLUGS` does not cover every path.** `selva/src/routes/setup/+page.server.ts:69`
  and `selva/src/lib/server/auth-bootstrap.server.ts:98` create orgs with `slugify` alone, and
  stores do not validate. The set lacks the route dirs `docs`, `mcp`, `oauth` and lists `settings`,
  which is not one. ADR 0006 claims one validator every create path goes through.
- **B8. `definition-cover` matches files that never exist.** `storage/assetClasses.ts:56-66`
  accepts `.jpg/.jpeg/.png/.gif`, but `put` transcodes to WebP and `definitionPaths.image` always
  returns `cover.webp`. Fix: match `cover.webp` only.
- **B9. `deletePrefix('')` wipes the data dir.** `LocalStorageProvider.ts:56-64` calls `fs.rm` on
  `resolvePath(prefix)` and the guard allows the base dir. `storage/interface.ts:17-25` says
  "every file whose path starts with prefix", but both providers are directory-based. Fix: reject
  an empty or `/` prefix, and say "directory prefix".
- **B10. `put` silently renames.** `storage/interface.ts:12` returns `void` while `image.ts:57-61`
  rewrites `.png` to `.webp`, so `put('a.png')` then `get('a.png')` is null. Fix: document it, and
  return the final path.
- **B11. Extension beats content type.** `storage/image.ts:29` sends `application/pdf` named
  `x.png` to sharp, which throws. Separately, Supabase `bucketFor` sends unclassified paths to the
  public bucket, while `ASSET_CLASSES` says default-deny.
- **B12. `GuidSchema` accepts uppercase.** `definitions/schemas.ts:5-12` does not lowercase. Local
  keys by raw string, Supabase `uuid` columns compare case-insensitively.
- **B13. Whitespace-only names pass.** `organizations/schemas.ts:78-81`, `definitions/schemas.ts:42`
  use `.min(1)` with no trim.
- **B14. `withCacheBust` appends after a fragment.** `storage/cacheBust.ts:21-23`: `/a#f` gives
  `/a#f?v=1`. No caller passes a fragment.

## Bugs in providers and consumers

- **B15. Local share-link writes race.** `LocalShareLinkStore.ts:156` (`tryIncrementSolveCount`)
  and `:134` (`revoke`) do unlocked read-modify-write of the file, so a solve can un-revoke a link
  or lose a `create`, and caps overshoot. `LocalApiTokenStore` serialises with `locked()`.
- **B16. An invite can be accepted twice.** `invites/interface.ts:25` `markAccepted` returns
  `void`. Two submits both pass `getByTokenHash`, and `selva/src/routes/accept-invite/+page.server.ts:176`
  ignores the result. Fix: return `boolean` and claim before creating anything.
- **B17. Local `deleteOrg` leaves definitions live.** `LocalOrgStore.ts:~190-217` soft-deletes
  projects and never calls `definitions.deleteByProject`; Supabase does soft-delete definitions.
  `organizations/interface.ts:19-25` also says invites and compute overrides do not cascade, and
  both providers hard-delete them.
- **B18. `savePlatformServers` is not atomic on Supabase.** Delete, insert and share insert are
  separate PostgREST calls; a failure after the delete leaves no platform servers. The doc says
  "replaces the entire platform-server set".
- **B19. Session refresh depends on OAuth.** `selva/src/hooks.server.ts:315-317` calls the
  deprecated `IOAuthAuth.refreshSession` and runs only when `providers.auth.oauth` exists, so a
  provider with `sessionRefresh` but no OAuth is never refreshed.

## Interface contracts

- **C1.** `permissions/interface.ts:38-48` says `hasInstanceAdmin` and
  `countInstanceAdminsExcluding` must exclude disabled users. `LocalPlatformPermissionStore.ts:100-112`
  counts every row.
- **C2.** A plaintext `apiKey` at rest throws on local (`LocalComputeServerStore.ts:93`) and warns
  and returns it on Supabase (`decryptRowApiKey`). `computeServer/interface.ts:50-63` lists neither.
- **C3.** `saveOrgServers` given a wrong-scoped server: local rewrites it, Supabase drops it. The
  local `.filter((_s): _s is ComputeServerConfig => true)` does nothing.
- **C4.** `shareLinks/interface.ts:10,35` says reads filter revoked links. Both providers also hide
  expired ones.
- **C5.** A repeat Supabase `revoke` emits `share_link.revoked` again; local emits once. The
  interface says idempotent.
- **C6.** `LoginResult` reason `'rate_limited'` (`auth/types.ts:29`) is never produced.
- **C7.** `auth/interface.ts:263` says a delegated session lasts about a minute.
  `selva/src/lib/server/providers.server.ts:55` sets it to the solve deadline plus 60 s.
- **C8.** `shareLinks/schemas.ts:12` says omitted `maxSolves` applies the default cap. The schema
  does nothing; `server/src/handlers/shareLinks.ts:85` and `server/src/testing/harness.ts:313` do.
  Fix: `.nullable().default(DEFAULT_SHARE_LINK_MAX_SOLVES)`.
- **C9.** `pagination.ts:3-6` says adapters default to `createdAt` desc. `LocalDefinitionStore.ts:96-101`
  defaults to `name` asc. `orderBy` is ignored by the Supabase member, invite and token lists.
- **C10.** README says the delete flow is blob-first; `definition-service.ts:219-220` deletes the
  record first and says why.
- **C11.** `DefinitionVersionSchema` and `DefinitionFileExtSchema` are dead. `DefinitionChannel` and
  `PlatformProjectGranteeType` are hand-written next to their enum schemas.
- **C12.** `events/audit.ts:30-41` says clamp to 200, and `SupabaseAuditQuery.ts:11-12` redeclares
  both limits. `Math.floor(0.5)` gives 0, so a fractional limit returns no rows and a null cursor.

## Duplication

- **D1.** `assertCanRead`, `assertCanReadBatch`, `assertAdmin` are identical in both permission
  stores. Move them next to `assertNotShareContext`.
- **D2.** `canManage` and `canEditProjectSettings` (`access/rules.ts:146,155`) have the same body.
- **D3.** `selva/src/routes/projects/+page.svelte:116-125` `serverNameFor` reimplements
  `resolveServerForOrg`.
- **D4.** The compute timeout default and clamp are comments in `computeServer/types.ts:33-36` and
  `30000` literals in `selva/src/routes/admin/compute/+page.svelte`. Export constants.
- **D5.** The offset cursor is written twice (`providers/local/src/data/pagination.ts`,
  `providers/supabase/src/data/pagination.ts`). Local `Math.max(1, NaN)` is `NaN`, so `slice`
  returns nothing. Put it in `pagination.ts` here.
- **D6.** `assertCanAccess` is copied between the user-profile providers; `MAX_RECENT_RUNS = 20` is
  declared in both, and the interface says "e.g. 20".
- **D7.** The safe-key alphabet is written three times (`SAFE_SEGMENT`, two `assertSafeKey`). `GUID`
  duplicates `UUID_REGEX`, with a comment saying to keep them in sync.
- **D8.** `src/index.ts` re-lists every subpath symbol by hand. Root imports outnumber subpath
  imports about 335 to 20. Fix: `export * from './x/index.js'` per area.

## Logic that does not earn its place

- **L1.** `ApiTokenRevokeReasonSchema` only derives a type. `orgServersFor` has no caller.
- **L2.** `ISolveResultCache`, `NoopSolveResultCache`, `SolveCacheKey`, `SolveCacheSetOptions` have
  no code user. `solveCacheLimit` is stored, writable over HTTP, and read by nothing.
- **L3.** Nothing writes or serves `orgs/{id}/private/*`. `orgPaths.privateAsset` is called by a
  test only, yet the files route has an `org` branch for it.
- **L4.** `auditUpdate` and `auditSoftDelete` are used only by the local provider, and the header
  says stores stamp on every mutation.
- **L5.** `defineConfig` returns the union, so it adds no inference.
- **L6.** Doc blocks sit on the wrong declarations: `computeServer/utils.ts:51-58` above
  `ResolveOptions` rather than `resolveServerForOrg`, `computeServer/secrets.ts:8-21` above
  `isEncryptedSecret` rather than `encryptSecret`.

## Public API candidates

Removal is a major bump. Checked against this repo and the external consumer.

- **P1. No user anywhere:** `orgServersFor`, `ApiTokenRevokeReasonSchema` (value),
  `IMAGE_MAX_WIDTH`, `IMAGE_WEBP_QUALITY`, `isImageUpload` and `toWebpPath` (outside platform),
  `isPublicAssetPath`, `AssetVisibility`, `AssetScope`, `AssetClass`, `AssetMatch`,
  `ALL_ORG_ASSET_KINDS`, `CreateOrgInput`, `UpdateOrgInput`, `DefinitionChannelSchema`, `UUID_REGEX`,
  `COVER_IMAGE_EXTENSIONS`, `ALLOWED_UPLOAD_EXTENSIONS`, `PlatformProjectGrantSchema`,
  `PlatformProjectGranteeTypeSchema`, `PlatformProjectGranteeType`, `AuditUpdate`, `AuditSoftDelete`.
- **P2. Docs or the external consumer only:** `RESERVED_SLUGS`, `SlugSchema`, `NoopBindingResolver`,
  `OrgAssets`.
- **P3. Subpaths with no importer:** `./userProfile`, `./platformProjects`, `./organizations`,
  `./utils`. `./auth`, `./data`, `./permissions`, `./invites`, `./apiTokens`, `./shareLinks`,
  `./access`, `./events` are named in docs only.
- **P4.** `OPERATOR_PLATFORM_PERMISSIONS` is in the root barrel and missing from
  `permissions/index.ts`. Other root-only symbols: `DEFAULT_PAGE_LIMIT`, `MAX_PAGE_LIMIT`,
  `NoopBindingResolver`, `NoopErrorReporter`, `NoopLogger`, `NoopSolveMetricSink`,
  `NoopSolveResultCache`, `ProviderError`, `SYSTEM_CONTEXT`, `assertNotShareContext`, `defineConfig`,
  `hasPermission`, `isFlagEnabled`, `isShareContext`, `requireActingOrg`.

## Package and config

- **K1.** 176 of 352 tarball files are `.map`. Their `sources` point at `../../src`, which does not
  ship, and `sourcesContent` is absent, so every map is a dead link. Fix: turn them off for publish
  or ship `src`.
- **K2.** `description` and the README say "Pure TypeScript interfaces", but the package ships a
  sharp transcoder, `node:crypto` secrets, Zod request schemas, slug logic and vitest suites. The
  README's interface table omits several interfaces and does not mention the `sharp` peer.
- **K3.** README "Testing your adapter" says passing matches "the in-memory reference", which does
  not exist, and that suites do not cover concurrency, which some do. Its suite list is partial.
- **K4.** `storage/image.ts:76` raises `preserve-caught-error`, the only lint warning.

## Tests

Local conformance runs under `pnpm test`. All Supabase conformance files skip without a live stack.

### Interfaces and methods with no conformance test

- **T1.** `computeServerStoreSuite` never calls `getServerApiKey`, `getConfig({includeApiKeys})`,
  `getConfig({scopeToOrgId})` or `verifySecrets`.
- **T2.** `eventSinkSuite` covers 9 of about 33 `DomainEvent` types and never tests `tokenId`
  stamping. It tests what stores emit, never an `IEventSink` against "MUST NOT throw" and per-actor
  ordering. `IAuditQuery` has no suite and `SupabaseAuditQuery` no test.
- **T3.** `authProviderSuite` skips `ISessionRefresh`, `IOAuthAuth`, `IProxyAuth`,
  `IDelegatedSession`, `registerUser`, `touchLastLogin`, and `verifyLogin` after `disableUser`.
- **T4.** `orgStoreSuite` never calls `updateOrgMemberPermissions`, and the `deleteOrg` cascade test
  skips `IApiTokenStore.deleteByOrg` and `IPlatformProjectGrantStore.deleteByGranteeOrg`.
- **T5.** `userProfileStoreSuite` tests neither ctx scoping nor the `recordRun` cap and dedupe.
- **T6.** No suite for `ISolveResultCache`, `INotificationProvider`, `IBindingResolver`, `ILogger`,
  `IErrorReporter`.
- **T7.** No suite races `tryIncrementSolveCount`, the one thing it exists for.
- **T8.** `outsideTokenOrg` and `apiScopeActionCovers` have no direct test.

### Suites not run against every implementer

- **T9.** `HeaderAuthProvider` never runs `runAuthProviderConformance`; the suite assumes a password
  provider. Fix: split it into core, password and proxy.
- **T10.** Local runs neither `runSolveMetricSinkConformance` nor `runEmailLinkAuthConformance` (no
  implementers). Supabase has no grant-store run, because its store is `notImplementedGrantStore`.

### Weak assertions

- **T11.** `shareLinkStoreSuite.ts:205,221,237,250,269`: `if (!scope.orgId) return;` passes with no
  assertion, while the comment at `:199-201` says `it.skipIf`. Same shape at
  `authProviderSuite.ts:59,71`.
- **T12.** `computeServerStoreSuite.ts:103`: "returns an empty servers list" asserts only
  `Array.isArray`.
- **T13.** `inviteStoreSuite.ts:104-131`: `markAccepted sets acceptedAt + acceptedByUserId` never
  reads either field, the idempotence test has no assertion, and `listByOrg` checks `length >= 3`.
- **T14.** `definitionStoreSuite.ts:713-726`: `listPublic` never makes a project public, so it
  passes on an implementation that ignores visibility.
- **T15.** `emailLinkAuthSuite.ts:78,82` has `void '';` and `void createAdapter;`. `sendMagicLink`
  accepts `rate_limited`, so a provider that always returns it passes. `validEmail` is unused.
- **T16.** `authProviderSuite.ts:146-165` asserts four fields undefined on a type that omits them.

### Pins that do not match the interface

- **T17.** `storageProviderSuite.ts:174-222` requires transcoding and rewriting to `.webp`.
  `IStorageProvider` does not promise it, so a correct S3 provider fails.
- **T18.** `platformProjectGrantStoreSuite.ts:132` pins `delete` throwing on an unknown id, which the
  interface does not specify and sibling stores contradict.
- **T19.** `ctxIsolation` and `singleOrgMode` are never passed by a provider test, so those cases are
  dead. The `singleOrgMode` case named `getOrg returns the default organization` calls `listOrgs`.
- **T20.** `slug-schema.test.ts:17-24` iterates `RESERVED_SLUGS`, so it passes however the list
  changes and cannot catch drift from the route tree. Its header cites an audit and an ADR.

### Duplication

- **T21.** `definitionStoreSuite.ts:69-87` and `shareLinkStoreSuite.ts:18-33` reimplement
  `ctx()`, a `tokens` Map and `recordTokensFromScope`, which `helpers.ts:61-87` provides.
- **T22.** The empty-permission system context is hand-built about nine times. `SYSTEM_CONTEXT`
  carries all permissions, so add `makeSystemCtx()`.
- **T23.** `scope.test.ts`: `round-trips upload:*` repeats the `parseApiScope` table.

## Comments and docs

- **N1.** History and pointers in source: `access/rules.ts:287-298`, `permissions/interface.ts:61`,
  `invites/interface.ts:35-39`, `computeServer/interface.ts:31-36`, `auth/interface.ts:83-88`,
  `index.ts:254`, `definitions/types.ts:169`, `solveCache/interface.ts`, `notifications/interface.ts:~48`,
  `organizations/schemas.ts:3-13`.
- **N2.** History in suites: `platformPermissionStoreSuite.ts:9,167`, `authProviderSuite.ts:139-144`,
  `storageProviderSuite.ts:178`, `definitionStoreSuite.ts:391-402`, `userProfileStoreSuite.ts:5`.
- **N3.** `errors/interface.ts:5` names `authToken`; the `RequestContext` field is `adapterContext`.
- **N4.** `SupabaseStorageProvider.ts:~89` calls objects content-addressed and immutable and caches
  them for a year, while `put` upserts and `withCacheBust` exists because bytes change at one URL.

## Checked and found clean

`apiTokens/scope.ts` logic; `canView`, `canSolve`, `canEdit`, `canManage`, `canReclaim`,
`canCreateProject`, `canChangeOrgRole`, `checkOwnerRemoval`, `canEditDefinition`;
`serversVisibleTo`, `defaultServerIdFor`, `resolveServerForOrg`; `encryptSecret` and
`decryptSecret`; API-token store parity between providers; the exports map against `dist`; `files`
stripping `__tests__`; `publint --strict`; peer ranges.
