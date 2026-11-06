# `@selvajs/platform` review: source, tests and conformance kit

> **Tracked in:** unfiled. Review of `packages/platform`. Findings already fixed are removed from
> this document; `git diff packages/platform` shows them. Line numbers drift: when one stops
> resolving, grep the quoted text.

Each finding carries a confidence tag: `read` (the author opened the code) or `name-only` (judged
from names, line counts or a search; open it before acting).

Checked in [platform-review-validation](./platform-review-validation.md): read its corrections
before acting on this document.

## Ground rules

- `@selvajs/platform` is published at 1.0.0. An external consumer imports about 55 symbols from
  `.`, `./config` and `./definitions`. Removing or renaming a public export is a major bump, so
  [Public API candidates](#public-api-candidates) stay apart from fixes that leave the API alone.
  The conformance kit (`./testing`) is public API too: a new ungated case can turn a third-party
  adapter red.
- **A test earns its place** only if it exercises a case a caller or an adapter can actually hit,
  and its assertion fails when that behaviour breaks. A test does not earn it if it restates the
  implementation, mocks away the thing under test, asserts a constant or a shape the compiler
  enforces, repeats another case with cosmetic input changes, reaches an internal helper through an
  input no caller produces, pins accidental behaviour, or is named after a release or issue.
- The conformance suites are both shipped code and tests, so both sets of rules apply to them.

## Source: duplication

- **Platform-project branch copied four times** in `access/rules.ts`. `canView` (:75-82) and
  `canSolve` (:107-113) repeat the grant matcher
  (`granteeType==='user' && granteeId===userId || granteeType==='org' && granteeId===actingOrgId`)
  and the `!enablePlatformProjects` / `instance_admin` prelude; `canEdit` and `canManage` repeat the
  prelude. One `platformAccess(input, needsSolve)` keeps every exported rule name. `read`
- **32-byte key check written twice.** `config/resolve.ts:102-108` (`isKey32`, with a comment
  "Same rule as decodeSecretKey") re-implements the hex-or-base64 round trip in
  `computeServer/secrets.ts:78-91`. The boot check and the decoder can drift. One helper that both
  call. `read`
- **At-rest key loading copied into both providers.**
  `providers/local/src/data/LocalComputeServerStore.ts:60-67` and
  `providers/supabase/src/data/SupabaseDataProvider.ts:108-120` repeat the "Missing required env var:
  SELVA_AT_REST_KEY ... generate with node -e" message and the `previousKey(env, ...)` +
  `decodeSecretKey` pairing. A `readAtRestKeys(env)` in `computeServer` returning
  `{ current, previous? }` removes both copies. `read`
- **`trimTrailing` in four places:** `utils/trim.ts:3` here, byte-identical copies in
  `packages/server/src/compute/trim.ts` and `packages/providers/supabase/src/trim.ts`, and a variant
  in `packages/compute/src/core/server/validate-server-url.ts:88`. Server and Supabase already
  depend on this package; compute cannot. `read`
- **Page-limit clamp re-implemented outside `clampPageLimit`.** `packages/server/src/api/pagination.ts:19-22`
  (trunc instead of floor), `packages/selva/src/routes/api/admin/orgs/+server.ts:25` (default 200),
  `HeaderAuthProvider.listUsers` (:334-336, default 25, hand-decoded cursor) and
  `SupabaseAuthProvider.listUsers` (:269-273, no upper clamp at all). The defaults disagree, so
  merging needs a decision on each. `read`
- **Request-body field rules.** `definitions/schemas.ts:27-55` writes every field of
  `CreateDefinitionInputSchema` again in `UpdateMetadataInputSchema` (lengths 256, 2000, 2048, 128,
  64x20). Name rules are written three ways: `CreateOrgSchema.name` (`organizations/schemas.ts:102`),
  `CreateProjectBodySchema.name` (`packages/server/src/api/bodies.ts:46`), with `.trim()` before
  and after `.min`. `read`
- **Channel enum re-declared.** `packages/server/src/api/bodies.ts:35` and
  `api/responses-schema.ts:31` write `z.enum(['live','draft'])`; `DefinitionChannelSchema`
  (`definitions/schemas.ts:24`) is the same, unexported. `ShareLinkResponseSchema`
  (`responses-schema.ts:28`) re-lists every `ShareLink` field by hand. `read`
- **Types hand-mirrored next to their source.** `DefinitionStatus` (`definitions/types.ts:26`) next
  to `DefinitionStatusSchema` (schemas.ts:22, which lacks `pending`); `DefinitionFileExt`
  (types.ts:5) next to `GH_EXTENSIONS` (types.ts:7); `PlatformProjectGrant` (`platformProjects/types.ts:13`)
  next to an unused `PlatformProjectGrantSchema`; `SCOPE_PATTERN` (`apiTokens/types.ts:30-32`)
  next to `ApiScopeActionSchema`. A new value added to one side compiles. `read`
- **Smaller copies:**
  - `packages/selva/src/lib/server/mcp/tools.ts:29` re-declares `DefinitionListItem`'s fields;
    `:66` copies `UUID_REGEX`.
  - `packages/selva/src/routes/team/members/+page.svelte:144` re-derives
    `MEMBER_ASSIGNABLE_PERMISSIONS`.
  - `packages/server/src/api/bodies.ts:104` casts `ALL_ORG_PERMISSIONS` into `z.enum` while
    `OrgPermissionSchema` is imported in the same file.
  - `packages/selva/src/lib/server/compute/engine.server.ts:20` and `providers.server.ts:240`
    hand-parse the truthy set `config/resolve.ts:45` holds.
  - `context.ts:104-121`: `assertCanReadPermissions` repeats the batch variant's preamble.
  - `definitions/paths.ts` and `organizations/paths.ts` spell the `x/${id}/` prefix in every
    builder instead of building from `prefix()`. `read`

## Source: logic that does not earn its place

- **`withAdminBypass` (`access/rules.ts:21`) and the header that recommends it (:13-14).** No
  production caller (only `providers/local/.../rules.test.ts:637`). The header says the admin
  bypass "is not baked into rule bodies", but every platform-project branch checks
  `instance_admin` inside the rule. Wrapping a content rule in it would reopen platform projects
  with `enablePlatformProjects` off and private projects with no member row; `packages/server`
  deliberately refuses an admin bypass on content. Rewrite the header; see Public API. `read`
- **`ProjectAccessInput.orgPermissions` (`access/rules.ts:30`) is required, filled by the server,
  read by no rule** (only `CreateProjectAccessInput` at :258 reads its own copy). `read`
- **`validateProjectFlags` (`projects/schemas.ts:15-26`)** returns two issues for one field when a
  platform project sets `autoJoinOnUpload`: the first branch already fires for every non-public
  visibility. Make the second an `else`. No test. `read`
- **`config/report.ts:92`** `|| raw === undefined` cannot fire after the `unset` early return.
  `read`
- **`storage/image.ts`:** `bmp` is in the extension regexes (:36, :45) but not in
  `ALLOWED_FORMATS` (:22), so the `.bmp` rewrite is unreachable; `mod.default ?? (mod as unknown as
SharpFn)` (:143-144) is a CJS fallback with two double casts, and the peer range starts at 0.34.
  `read`
- **`events/interface.ts` `actorFrom`/`actorOf`** accept a `system?` field they never read. `read`
- **`organizations/paths.ts:15-16`** runs `assertSafeKey` on a closed-enum `OrgAssetKind`. `read`
- **`platformProjects/schemas.ts:5` `PlatformProjectGrantSchema`** has no reader at all. The 1.0.0
  CHANGELOG lists it as "still used inside the package"; it is not. `read`
- **`providers/local/src/data/secretCrypto.ts`** is a re-export shim over
  `@selvajs/platform/computeServer` with a history comment; two importers. `read`
- **Two `JSDoc` blocks on `IInviteStore.markAccepted` (`invites/interface.ts:24-25`).** The first
  ("No-op if already accepted.") contradicts the second (returns a boolean). `read`

### Comments and docs that break the repo's rules

- `auth/interface.ts` is 337 lines with 242 comment lines. It names app routes
  (`/auth/{provider}/start`), `hooks.server.ts`, the session-refresh middleware, "future Eterna",
  and Supabase's `revalidateMs` default. What an adapter author needs is about 40% of it: the
  `IProxyAuth` trust boundary, null-versus-throw on verify/exchange/refresh, `revokeSession`
  semantics, who enforces `last_admin`, and the re-check before each `mint`. `read`
- `auth/interface.ts:244-246`: `mint` is documented as "valid for `ttlSeconds` (default 60 s)"; the
  signature has no `ttlSeconds`. `read`
- `context.ts:56-58`: `hasPermission` says an org permission without `actingOrgId` returns false.
  The body never reads `actingOrgId`. `read`
- `solveCache/interface.ts:63-73,92-96`, `definitions/types.ts:66-72`, `schemas.ts:51-52`: status
  lines ("No implementation ships today", "**Dormant**") and infra plans (adapter-node, Redis),
  repeated three times. `read`
- History and planning pointers: `computeServer/secrets.ts:14-33` (v1 "still read: a store
  rewrites them"), `storage/image.ts:132-134`, `definitions/schemas.ts:19-21,59` (names a route
  that moved), `shareLinks/schemas.ts:4-7`, `events/interface.ts:~11` (points at a DELETE handler
  in another package), `organizations/types.ts:3-8`, `logging/interface.ts:1-8`,
  `errors/interface.ts:25-30,40-44` (app internals), `pagination.ts:2-8` (per-adapter behaviour).
  `read`
- Suites: "Permissions spec §6" (`definitionStoreSuite.ts:5-6,450`), "§2/§8/§10"
  (`platformPermissionStoreSuite.ts:6,29,60,134,215`), "Permissions spec §9"
  (`eventSinkSuite.ts:2`), adapter history (`platformPermissionStoreSuite.ts:215-218,295-300`,
  `shareLinkStoreSuite.ts:150-152`), CI timings (`storageProviderSuite.ts:155-160`).
  `eventSinkSuite.ts:10-13` says "Local stays on NoopEventSink"; the local conformance test injects
  a `RecordingEventSink`. `read`
- `secrets.ts:96`: `plaintext_on_disk` is described as "isn't an `enc:v1:` envelope"; v2 exists.
  `read`
- `errors.ts:1-4`: the JSDoc sits on `const BRAND`, not on `ProviderError`. `read`

### Types

- `metrics/interface.ts:50-54`: `ok: boolean` and `failureKind` (which includes `'ok'`) encode one
  fact twice; `{ ok: true, failureKind: 'timeout' }` type-checks. `read`
- `auth/interface.ts:61`: `getOAuthAuthorizationUrl` takes `'google'|'github'|'azure'|'gitlab'`
  while `listProviders()` returns `readonly string[]`; Supabase repeats the union. `read`
- `ShareLink.expiresAt/revokedAt/maxSolves` are `?: T | null` (`shareLinks/types.ts:18-24`). The
  handler always sets all three, and "null means never expires" reads `undefined` the same way.
  `read`
- `RequestContext.platformPermissions/orgPermissions` are mutable arrays while `apiScope.scopes` is
  `readonly`. `read`
- `config/resolve.ts:17,31`: `KeyReport.value` and `ResolvedConfig.values` are `unknown`, so every
  reader casts. `read`
- `computeServer/secrets.d.ts` exposes `Buffer` in four public signatures and the package declares
  no `@types/node`. A consumer with `skipLibCheck: false` and no Node types gets TS2591
  (reproduced against the packed tarball). `read`
- `auth/types.ts:9`: `AuthUser.metadata` "never holds PII". header-auth puts `upn` and
  `displayName` there; Supabase passes `user_metadata` through whole. A reader who trusts the doc
  may log it. `read`

## Public API candidates

Each was searched repo-wide (packages, docs, plans, archived plans, examples) and against the
external consumer's import list. None is used by that consumer.

- **`withAdminBypass`**: no production caller; its use is unsafe on content rules. Deprecate now,
  remove on the next major. `read`
- **`IBindingResolver`, `NoopBindingResolver`, `SelvaConfig.bindingResolver`**: declared, never
  read or implemented. `docs/adr/0001-pre-step-producers.md` mentions the seam. `read`
- **`ISolveResultCache`, `NoopSolveResultCache`, `SolveCacheKey`, `SolveCacheSetOptions`,
  `DefinitionRecord.solveCacheLimit`**: no implementer, no reader. Several `plans/features/*` name
  the seam as future work. `read`
- **`assertNotShareContext`**: root export, used only inside `context.ts`. Documented as the way a
  store refuses share contexts, so it may serve third-party adapters. `name-only`
- **Access input types** `VisibilityChangeInput`, `ReclaimAccessInput`, `CreateProjectAccessInput`,
  `OrgOwnerAuthorityInput`, `OwnerRemovalInput`, `OwnerRemovalCheck`, and `ApiScopeResource`: no
  importer, but each is a parameter or return type of an exported function. Keep. `name-only`
- **`DefinitionListItem`, `SlugSchema`, `CreateShareLinkInput`, `TranscodeResult`,
  `NotificationKind`, `ResolveOptions` (two unrelated ones, on `.`/`./computeServer` and
  `./config`), the config `*Setting` types**: no importer by name, but each sits in a public
  signature. Keep. `DefinitionListItem` should be imported by `selva/src/lib/server/mcp/tools.ts`
  instead of re-declared. `read`
- **`runPasswordAuthConformance`**: no consumer imports it; reached through
  `runAuthProviderConformance`. Keep (third-party adapters may compose it). `read`
- **Test-kit types** `SeedUserFn`, `SeedUserResult` and `DefinitionTestScope` are _missing_: an
  adapter author cannot name the type of its own `seedUser` or `createScope`. Additive. `read`

## Package, scripts and config

- `package.json`
  - `main` and top-level `types` help only node10 resolution of `.`; every subpath already fails
    there (attw). Harmless; keep or drop together.
  - `files`: `!**/*.spec.*` and `!**/*.test.*` are redundant with `!**/__tests__/**`, but
    `scripts/release/verify-pack.mjs` asserts the same three patterns. Leave.
  - Peer ranges `sharp ^0.34 || ^0.35` and `vitest ^3.2.4 || ^4 || ^5` claim versions CI never runs
    (catalog: sharp 0.35.5, vitest 5.0.5). Narrow to what is tested, or add a matrix.
  - `@types/node`: see Types above.
- `tsconfig.json`: `sourceMap:false`/`declarationMap:false` are right (src is not shipped). Tests
  compile into `dist` (40 files) and `files` filters them out: wasted work only.
- `eslint.config.js`: the extra `ignores` repeat the shared config. `eslint.typed.config.js` is
  correct, but **CI never runs `lint:types`** (`.github/workflows/test.yml` runs lint, type-check,
  check, test).
- Monorepo:
  - `turbo.json` `test`/`lint` inputs omit `../config/**`, so a shared vitest or eslint config
    change can hit a stale cache. `name-only` (not run).
  - `packages/config/vitest.config.js:21-23` says production resolution picks `import`; the selva
    app's Vite build keeps `selva-source` first and bundles platform `src`. The comment is wrong
    for that build.
- Packaging is otherwise clean: `publint --strict` passes; attw is green for bundler and
  node16-ESM on all 20 entries; no vitest or sharp type reaches a non-testing entry; `sharp` loads
  lazily.

## Tests

### Unit tests (`src/**/__tests__`, 20 files)

Delete whole:

- `bindings/__tests__/noop-binding-resolver.test.ts`: asserts the Noop returns an empty map.
- `__tests__/public-api.test.ts`, except one case: the root barrel must not export
  `encryptSecret`/`decryptSecret` (keeps `node:crypto` out of the browser-safe root). The
  "what the major took out" case (7 barrels x 14 names) is named after a release; a missing
  re-export already fails `tsc` in every consumer.
- `__tests__/package-shape.test.ts`: re-reads `sideEffects` from package.json and greps image.ts for
  a static `import('sharp')`. The grep misses `import sharp from 'sharp'`. If the guard is wanted,
  a bundle smoke test of the root barrel is the honest version.

Trim:

- `apiTokens/__tests__/scope.test.ts`: the action-implication matrix is asserted three times
  (:48-66 table, :86-92, :155-168). Keep the table, add the missing `solve`/`upload` rows, drop the
  rest. Drop "is described in plain words" (:177, pins English) and "carries the key's expiry"
  (:150, a field copy). Cut the 7 round-trip rows to one per resource kind.
- `organizations/__tests__/slug-schema.test.ts`: drop "reserves o" (:22, a constant), merge
  :64-66 into :44-47 and :54-56 into :70-74.
- `computeServer/__tests__/pick-server.test.ts:20-25`: `resolveServerForOrg` throws on empty;
  `packages/server/src/compute/__tests__/resolve-server.test.ts:64` covers it through the real
  wrapper.
- `storage/__tests__/image.test.ts`: parametrize "caps height" (:125) and "sliver too tall"
  (:131) into one case.
- `storage/__tests__/assetClasses.test.ts:11-13`: four cover extensions through one regex; one row.
- `config/__tests__/report.test.ts`: drop the fingerprint determinism case (:102) and "an
  unchanged env diffs empty" (:141).

Keep: `errors.test.ts` (cross-copy `instanceof`), `context.test.ts`, `pagination.test.ts`,
`guid-schema.test.ts`, `previous-key.test.ts`, `resolve.test.ts`, `secrets.test.ts`,
`decode-secret-key.test.ts`, `scope-config.test.ts`, `cacheBust.test.ts`, `rules.test.ts`.

Gaps (no test anywhere, checked against providers, server and selva tests):

- `canReclaim`, `canCreateProject` branches; `canEdit`/`canSolve` with `enablePlatformProjects`
  off.
- `validateProjectFlags` (and its double issue).
- `assertSafeKey` and `hasUnsafeSegment` as units (only selva's file-route test reaches the
  latter).
- `hasPermission`: `instance_admin` implies an org permission; share context with platform
  permissions.
- `MEMBER_ASSIGNABLE_PERMISSIONS` excludes `manage_org_members` and `manage_org_compute`.
- `config/snapshot.ts` `removed` change kind; `resolve.ts` url/list/int-max/minLength paths and
  the trailing-slash trim.
- `utils/audit.ts` fallback actor when `ctx.userId === ''`.
- `definitions/schemas.ts` bounds and null-clears on `UpdateMetadataInputSchema`.

### Cross-file overlap

- Action-implication matrix | scope.test.ts three places | keep the table.
- `isKey32` vs `decodeSecretKey` | resolve.test.ts:176-186, decode-secret-key.test.ts | fix the
  source duplication, then keep the decoder tests.
- `resolveServerForOrg` throws | pick-server.test.ts, server resolve-server.test.ts | keep server.
- SVG rasterisation | image.test.ts:143-151, storageProviderSuite.ts:214 | keep the suite case.
- `canView`/`canEditDefinition` matrix | platform rules.test.ts, local rules.test.ts:162-190 and
  :497-635 | keep local for the matrix; platform keeps only cases local lacks (member outside org,
  commons create, acting-org mismatch, cross-project edit).

### Conformance kit (`src/testing`, about 5,000 lines, shipped)

Structural problems, in order of impact:

- **Every suite ctx is `instance_admin` by default** (`helpers.ts:25`). The "outsider" in the
  `ctxIsolation` cases (`definitionStoreSuite.ts:795`, `orgStoreSuite.ts:473`,
  `projectStoreSuite.ts:411`) carries `instance_admin`, so an adapter that filters by `ctx` as the
  README requires must show it the record and fails. Only adapters that enforce scoping in the
  database pass. Local runs no isolation case at all. Default to no permissions and opt in.
- **Denials assert `.rejects.toThrow()`** in `platformPermissionStoreSuite.ts:104-116,288-293,322-329`,
  `projectStoreSuite.ts:144,153`, `platformProjectGrantStoreSuite.ts:102`,
  `definitionStoreSuite.ts:433`, `userProfileStoreSuite.ts:43-46`. A `TypeError` passes. Assert
  `{ statusCode }`; add an `expectStatus` helper (four hand-rolled try/catch blocks in the
  definition suite already do this the long way).
- **Cases that assert what the test just wrote**: "create populates createdBy/updatedBy and
  deletedAt=null" in the definition (:669), org (:359) and project (:271) suites, and the
  versioning-scaffold null defaults (:680). The `?? null` accepts `undefined`.
- **Dead options**: `orgStore.singleOrgMode` (and its two branches), `platformProjectGrant.seedProject`,
  `platformPermission.cleanup` with an empty `beforeEach`, `solveMetric.cleanup`, and the
  `authProvider` `userManagement:false` branch (four cases no provider runs; "createUser is
  undefined" would fail `HeaderAuthProvider`, which implements `createUser`). Public options, so
  removal is a semver call.
- **`userManagement` and `passwordless` default to false**, so an adapter that omits them gets the
  stricter set. That contradicts the README's "new cases go behind an option".
- **The README promise is not enforced.** No mechanism keeps new cases gated; the 1.0 cycle added
  whole suites and many cases ungated (fine for a major, but the README states it as a rule).
- **Scaffolding copied per suite**: the `createScope` + `registerToken` helper (4 suites),
  module-level `makeSeedHelpers` in the definition and share-link suites (one token map per
  process), `randomSlug`, inline ctx literals that `makeCtx` already builds, `helpers.ts:94`
  returning an unused `tokens`.

Per suite, cases to drop or merge (survivor named):

- definition: drop "create + get" (:130, asserts only `guid`), "delete removes" (:655 → :690);
  merge the two pending-filter cases (:161, :175). "attachInitialVersion ... atomically" (:557)
  checks nothing atomic: rename.
- org: drop "deleteOrg removes" (:159 → :384), "removeOrgMember deletes" (:287 → :451); merge
  "createOrg + getOrg" with "getOrgBySlug" (:98, :115).
- project: drop "removeProjectMember deletes" (:244 → :319), "deleteProject removes" (:156 → :295),
  "createProject after delete+reactivate" (:366, never calls `createProject`); merge the two
  `autoJoinOnUpload` cases and make the default case omit the field.
- platformProjectGrant: drop "listByProject scopes" (:62 → :132).
- userProfile: merge "recordRun returns ok" (:150) into :49.
- apiToken: none.
- authProvider: drop "verifyLogin returns success" (:95), the absent-profile-fields case (:183,
  a migration guard), "createUser is undefined" (:237); merge "disableUser disables" into the
  refusal case (:214).
- computeServer: merge "saveOrgServers stores rows" (:192) into :206.
- invite: merge :104 into :120 and the two `revokePendingByEmail` cases (:157-182).
- shareLink: drop the sequential cap case (:300 → :264); merge the revoke and expiry pairs.
- solveMetric: drop "records the actor" (:98 → :89); merge failed-solve and counts cases.
- storage: merge the three put round trips; drop "nested directories" (:71), "non-empty URL"
  (:127), "consistent URL" (:133, signed URLs may differ).
- emailLink: loop the three malformed-URL null cases.

Gaps the interfaces promise and no case checks:

- `computeServer`: `getConfig({ scopeToOrgId })`. An adapter that ignores it passes all 14 cases.
- `definition.listPublic` (:749) never sets up a non-public project; the draft it creates is never
  asserted.
- `storage.deletePrefix('a/b')` must not reach `a/bc`.
- `platformProjectGrant`: every case runs as `SYSTEM_CONTEXT`, though the README marks the store
  ctx-scoped; Supabase does not run this suite at all.
- `userProfile`: no positive self-access control; the cap asserts `< 30` instead of
  `MAX_RECENT_RUNS`.
- `invite.revoke(id)` on an accepted invite; `deleteByOrg`; `listByOrg` never adds another org's
  invite.
- `shareLink.getById` on revoked/expired; `getByTokenHash` with a soft-deleted parent; revoke
  idempotency asserts nothing.
- `apiToken` revoke idempotency (:106) runs both revokes in the same millisecond.
- `eventSink`: 11 of 33 event types; no throwing-sink case.
- `solveMetric`: only `ok` and `timeout` persisted; `flushSink` may be sync but the case uses
  `.resolves`.
- `auditQuery`: no upper clamp, no tie on `occurredAt`.

## Simplification and architecture

### Request bodies move to `@selvajs/server/api/bodies.ts`

The split already costs something: the OpenAPI registry imports only from `@selvajs/server/api`
(`registry.ts:10-26`), so PATCH `/definitions/{guid}` (:135), POST `/publish` (:215) and POST
`/share-links` (:240) publish an empty request body although their handlers parse JSON
(`handlers/definitions.ts:260,300`, `handlers/shareLinks.ts:72`). `bodies.ts:8-9` names exactly
this failure.

- Minor, now: `bodies.ts` re-exports the three platform schemas as `*BodySchema` and the registry
  wires `requestBody`. Export `DefinitionChannelSchema` from platform (additive) and drop the two
  `z.enum(['live','draft'])` copies. README line 3 becomes "domain schemas (GUIDs, slugs, enums)".
- Major: move `CreateDefinitionInputSchema`, `UpdateMetadataInputSchema`,
  `PublishVersionInputSchema`, `CreateShareLinkInputSchema`, `CreateOrgSchema`, `UpdateOrgSchema`
  and the v1 DTO (`DefinitionListItem`, `toDefinitionListItem`, whose only caller is
  `handlers/definitions.ts:85`) into server. Platform keeps `GuidSchema`, `SlugSchema` and the enums.
  The external consumer imports `CreateDefinitionInputSchema`: one import line changes.
- Covered by: server `api/__tests__/bodies.test.ts`, `parse-body.test.ts`,
  `share-links-lifecycle.test.ts`; selva `api/v1/__tests__/conformance.test.ts`.

### One platform gate in `access/rules.ts`

The "flag off, then `instance_admin`" prelude appears five times (:75-77, 111-113, 132-135,
151-154, 217-220) and the grant matcher twice. A private `grantMatches()` and
`platformGate(input, grantAllows?)` make `canSolve` `platformGate(input, g => g.canSolve) ?? canView(input)`.
Patch, no API change; the 60 cases in platform's and local's rules tests pass against a scratch
refactor. A mutation that checks admin before the flag survives every pure rules test (only
server's `platform-visibility-gate.test.ts:122` catches it, for PATCH/DELETE): add one pure case
per rule. Deprecate `withAdminBypass` and fix the header in a minor; remove at the major. Make
`ProjectAccessInput.orgPermissions` optional now, drop it at the major.
`providers/local/src/data/__tests__/rules.test.ts` (762 lines) says it lives there because
"platform doesn't run its own vitest"; it does now, so move it.

### Dead seams

- **Binding resolver: a broken promise, not dead code.** `docs/adr/0001-pre-step-producers.md:22`
  marks the `server` source kind shipped through `IBindingResolver`, and the builder offers it
  (`BuilderGroupItem.svelte:273`). Nothing reads `SelvaConfig.bindingResolver`, so
  `NoopBindingResolver`'s doc ("every bound input fails at solve time") and `config.ts:57-61` are
  false. Fix those docs now; then either wire it into the solve path (minor) or remove the seam
  and the `server` kind together at the major, with a schema migrator. Keeping half helps nobody.
- **`ISolveResultCache`**: keep. `plans/features/scaling-roadmap.md:109-115` and
  `presolve-bundle.md:30-34` name it as the seam, and the archived caching plan kept it on
  purpose. The PATCH body still accepts `solveCacheLimit`, which changes nothing: drop it when the
  body moves.

### File moves that keep every public path (patch)

- `context.ts:91-132` guards move to `permissions/guards.ts` and `userProfile/guards.ts`; both
  barrels already re-export them. Fold the shared preamble.
- `config.ts` → `selva-config.ts` (`SelvaConfig` is a root export; `./config` doesn't hold it).
- `errors.ts` → `errors/provider-error.ts` with an `errors/index.ts`.
- `DefinitionListOptions` moves from `pagination.ts:21-44` to `definitions/types.ts`.
- Optional: kebab-case `storage/assetClasses.ts`, `cacheBust.ts`, `safeKey.ts` and the suite files.
  Folder names stay: they are the subpath names.

### Config

- `parseKey32(raw): Buffer | null` in a module with no `node:crypto`; `decodeSecretKey` throws on
  null, `isKey32` checks for it. Patch.
- `readAtRestKeys(env)` on `./computeServer` (additive), used by both providers.
- Export `readSetting(spec, env)` (the `resolveKey(...).value` already in `resolve.ts:123`) so
  server's hand-written readers (`limits.ts:34-75`, `sign-in-age.ts`) read the manifest instead of
  parsing again with looser rules. Defaults are written twice today (`COMPUTE_RATE_LIMIT_MAX` 120
  at `settings.ts:303` and `limits.ts:231`); `EnvRecord` is declared in `resolve.ts:4` and
  `limits.ts:25`. Most of this work is in server.
- `config/` stays here: providers declare manifests and Supabase calls `resolveConfig`; it is pure.

### Conformance kit

- The `instance_admin` outsider is a kit bug: fix it in a patch (it can only turn adapters green).
- Before tightening further, settle README rule 1. It says adapters "MUST filter ... by ctx", but
  local's definition, org and project stores ignore `ctx` (`LocalDefinitionStore.ts:133,187` take
  `_ctx`). Either narrow the README or make local enforce it.
- A non-admin default ctx and status-code denials go behind an option in a minor; flip the default
  at the major.
- Internal dedupe (patch): `makeSeedHelpers` inside `run*`, one scope/token helper,
  `expectStatus`.

### Derive types (patch)

`SCOPE_PATTERN` from `ApiScopeActionSchema.options`; `DefinitionStatus` as
`z.infer<typeof DefinitionStatusSchema> | 'pending'`; `DefinitionFileExt` and `GH_EXTENSIONS` from
one tuple (keep `GH_EXTENSIONS: string[]`, the consumer imports it); delete
`PlatformProjectGrantSchema`.

### Metrics `ok` (major)

Both producers write `ok: failureKind === 'ok'`. Remove `SolveMetric.ok`;
`SupabaseSolveMetricSink.ts:91` computes the column itself.

### Considered and left

- Moving `config/report` and `config/snapshot` to server: the consumer imports
  `buildConfigReport`, `ConfigReport`, `ReportRow`; a major for little gain.
- Keeping only the interface or only the Noop of a seam: still breaking, still half a seam.
- Removing the unused kit options (`singleOrgMode`, `seedProject`, `cleanup`,
  `userManagement`): hooks for third-party adapters; a major for no gain. Fix the
  `userManagement:false` case that would fail `HeaderAuthProvider` instead.
- The `canEditProjectSettings` alias: six importers, a separate decision point.
- Splitting `auth/interface.ts`: it is already seven capability interfaces; the weight is comments.
- Renaming camelCase folders: they are the published subpaths.
- `readonly` permission arrays on `RequestContext`: breaks writers for a cosmetic gain.

## File size

No file is too long to read. Three have more than one reason to change:

- `definitions/schemas.ts` (and `types.ts`): storage-key primitives mixed with HTTP bodies and the
  v1 DTO. The body move splits it.
- `context.ts`: the `RequestContext` shape plus the guards of two stores.
- `access/rules.ts`: project content rules, org governance rules (`canChangeOrgRole`,
  `canCreateProject`, `canReclaim`, `checkOwnerRemoval`) and admin-bypass policy. After the gate
  refactor, split into `project-rules.ts` and `org-rules.ts` behind the same barrel.

## Order of work

1. Fixes that leave the API alone: the comment and JSDoc corrections (`markAccepted`, `mint`,
   `hasPermission`, `rules.ts` header), `validateProjectFlags`, `report.ts:92`, the `bmp` regex,
   `isKey32` sharing one helper with `decodeSecretKey`, `readAtRestKeys`, the `secretCrypto.ts`
   shim, `trimTrailing` and the limit clamp in server and Supabase, `DefinitionListItem` in mcp.
2. Test cuts and gaps in the unit tests; CI runs `lint:types`; turbo inputs.
3. Conformance kit: helpers first (`expectStatus`, scope helper, non-admin default behind an
   option), then the gaps, each new case behind an option.
4. Decisions (below).
5. Public API changes, batched into the next major: request bodies and the v1 DTO to server,
   `withAdminBypass`, `ProjectAccessInput.orgPermissions`, the binding seam if it is not wired,
   `SolveMetric.ok`, the strict kit default.

## How to validate this document

- Confidence: source sections were read by slice; public-API rows were searched repo-wide and
  against the consumer's import list; conformance rows were read case by case but not run against
  a deliberately broken adapter.
- Not run: the turbo stale-cache claim; peer-range lower bounds; any Supabase suite (they skip
  without `.env.test`).
- Re-check: `cd packages/platform && pnpm type-check && pnpm lint && pnpm lint:types && pnpm test`;
  `pnpm exec publint --strict`; `rg -n "withAdminBypass|bindingResolver|NoopSolveResultCache" -g '!**/node_modules/**'`.
- Decisions for a human:
  - Where request-body Zod schemas live (README says both; the OpenAPI gap argues for server).
  - Wire the binding resolver or remove it with the `server` source kind.
  - Whether README rule 1 ("MUST filter by ctx") holds for local, or is narrowed.
  - Whether the conformance kit may tighten in a minor (new default ctx, status assertions).
  - The default for `listUsers`/admin list limits (25, 50, 200 today).
