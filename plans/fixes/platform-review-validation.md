# `@selvajs/platform` review: validation

Checks [platform-review-audit](./platform-review-audit.md) against the tree, then reports what three
independent reviews found that it missed. Line numbers drift: when one stops resolving, grep the
quoted text.

**How this was checked.** Every claim that would delete code, change the public API or change
config was verified, plus every test cut and about a third of the rest. Mechanical claims (unused
exports, CI wiring, config values) were checked by search, and a sample of those was re-checked by
hand. Test cuts were checked by reading the cut case and the named survivor side by side. Source
behaviour claims ran against a fresh `tsc` build of the package with Node. The independent reviews
saw none of the audit, wrote repro scripts against the same build and the built local provider, and
each of their findings was rerun by a second reader. A separate pass checked the audit's
recommendations against each other. The Supabase adapter ran against a local Supabase CLI stack:
its own suite (37 files, 422 tests, all green; CI's `supabase` job in `test.yml` runs the same),
then 14 probes for the gaps below ([Supabase adapter](#supabase-adapter)).

**Not verified.**

- The external consumer. It was checked by its import list only, not built against a changed
  package.
- Browser bundles. No claim about the root barrel in a browser build was run in one.
- The turbo stale-cache claim (no throwaway clone was hashed) and the peer-range lower bounds
  (sharp 0.34 and vitest 3/4 were not installed).
- Why `ISolveResultCache`, `IBindingResolver` and the unused kit options were added. History is
  read from plans and ADRs only.

## 1. Corrections to the review

### Source

- **CHANGELOG claim** (Logic, `PlatformProjectGrantSchema` bullet): WRONG. The line naming it as
  "still used inside the package" is under `## 1.0.0-beta.4`
  (`CHANGELOG.md:151`), not 1.0.0. The schema is still unused.
- **Platform branch "copied four times"** (Duplication): PARTLY. Five: `canEditDefinition`
  (`access/rules.ts:218-219`) has the prelude too. The architecture section already says five.
- **`hasPermission` JSDoc** (Comments): PARTLY. The doc is true for every context that keeps the
  invariant `RequestContext` documents at `context.ts:25` ("orgPermissions empty when actingOrgId
  is undefined"). Only a malformed context gets `true`. Imprecise, not false. The real share-link
  context (`selva/src/lib/server/shareLinks/resolve.server.ts:96-103`) carries empty permissions,
  so the share-context case is defence in depth.
- **`mcp/tools.ts` re-declares `DefinitionListItem`** (Smaller copies): PARTLY. It declares
  `DefinitionItem`, a subset (no category, tags, cover, solve count; `status: string`).
- **`report.ts:92`**: PARTLY. The clause is unreachable at runtime but narrows `raw` for
  `raw.trim()` on the next line; removing it needs a restructure, not a deletion.
- **`image.ts` CJS fallback** (`mod.default ?? mod`): UNSURE. Only sharp 0.35 is installed; Node's
  `import()` of a CJS module always sets `default`, but bundler shapes were not tested. Keep the
  `bmp` half (confirmed: sharp cannot read BMP, so the rewrite is unreachable).
- **At-rest key loading** (Duplication): line numbers off; the local message is at
  `LocalComputeServerStore.ts:~82`.
- **`trimTrailing`** (Duplication, Order 1): PARTLY. `utils/index.ts` exports only `auditUpdate`
  and `auditSoftDelete`, so server and Supabase cannot reuse it without a new export. Add
  "export `trimTrailing` (additive)" or leave the copies.

### Public API candidates

- **`ISolveResultCache` group**: contradicts the architecture section, which keeps it. Remove the
  group from the candidates. Dropping `solveCacheLimit` from the PATCH body is fine; dropping it
  from the exported `DefinitionRecord` is a major and needs saying.
- **`DefinitionListItem`**: the candidates list says keep it and point mcp at it; the
  architecture section moves it to server at the major. Pick one: either it stays in platform, or
  the mcp change waits for the move.

### Package and config

- **Narrow the peer ranges**: narrowing `sharp`/`vitest` peers is a breaking change for anyone on
  the older majors. Label it major, or keep the ranges and add a CI matrix.
- **`@types/node`**: the fix is missing. Either declare `@types/node` as an optional peer or type
  the public signatures as `Uint8Array`. The proposed `parseKey32` and `readAtRestKeys` add more
  `Buffer` to public types, so this comes first, and `parseKey32` must not live in a module the root
  barrel re-exports (`utils/`, `computeServer/public.ts`).

### Tests

- **`public-api.test.ts`**: PARTLY. The review says a missing re-export fails `tsc`, which is true
  for "re-exports each area" but backwards for "what the major took out": that case guards against
  _re-adding_ a removed export, which `tsc` cannot catch. Dropping it is a choice, not redundancy.
  It also pins `DefinitionChannelSchema` as absent, so the proposed export of that schema must
  change this test in the same commit.
- **`package-shape.test.ts`**: PARTLY. The `sideEffects: false` case is the only guard of that
  field: `publint` warns only when it is missing, never when it is `true`. Keep it. Replace the
  sharp grep (it matches only `await import('sharp')`) with one that also catches a static
  `from 'sharp'`.
- **`scope.test.ts` "described in plain words"**: keep. It is the only test of
  `describeApiScope`, and that function's wording is wrong for `create_projects` (new finding M3).
- **`report.test.ts:102`**: PARTLY. Keep the "different key gives a different fingerprint" half; a
  constant `sha256:00000000` passes the format check at :76.
- **`pick-server.test.ts:20-25`**: PARTLY. The server test covers the throw, but only by error
  class. Move the `/No compute servers/` message assertion into the server test before cutting.
- **Gap: `canReclaim`, `canCreateProject`**: PARTLY. Handler tests reach the reclaim happy path,
  the platform refusal and the member rejection. The tenancy-mismatch, admin-role and
  member-with-`manage_projects` branches are asserted nowhere.

### Conformance kit

- **"create populates createdBy/updatedBy and deletedAt"** (three suites): PARTLY. The survivors
  check only `updatedBy` after an update and `createdBy` preserved. Dropping loses `updatedBy` at
  create and `deletedAt`. Tighten the assertions (create as one user, read back) instead of
  dropping.
- **definition "delete removes the record"** (:655): WRONG to drop. The survivor "delete
  soft-deletes" checks `list` and `listByProject` only; an adapter that still returns a deleted
  row from `get()` passes it.
- **project "createProject after delete+reactivate"** (:366): PARTLY. Its name is wrong, but it
  is the only case running a second delete/reactivate cycle. Rename it.
- **Kit default ctx** (three statements: "patch", "behind an option in a minor", "flip at the
  major"): they conflict. `ctxIsolation` is already opt-in, so fixing the outsider ctx is a patch
  scoped to the `ctxIsolation` cases only. A non-admin default for every case is a separate
  option, flipped at the major.

### Simplification and architecture

- **Binding resolver**: PARTLY, and worse than the review says. A `server`-kind input never fails:
  the client seeds it with its default (`solve/src/client/session/solve-session-core.ts:80-88`) and
  the server sends `values[id] ?? input.default` (`solve/src/server/transform-input.ts:33`), so a
  caller who posts a value for that id sets it. See new finding H3. Wiring a resolver is not just a
  minor: the server must also ignore caller values for those ids.
- **README rule 1**: CONFIRMED, and rule 2 ("a mutating store method must remain safe even if the
  caller skipped" the rules) is false for local too: local's definition, org and project stores
  take `_ctx` on reads, and on writes use `ctx` only for the audit stamp. Scoping lives in the
  server guards (`server/src/access/guards.ts:523,561,580,617`). The kit already encodes the
  exception as the `ctxIsolation` option, so "narrow the README" means documenting that option.
- **`readSetting`**: PARTLY. `sign-in-age.ts:20` is _stricter_ than the manifest (it refuses
  `1e3`, `0x10`, `+7`), so moving it onto `readSetting` would loosen it unless the manifest's int
  parse is tightened first (M10). The doubled default is already pinned by
  `server/src/config/__tests__/settings.test.ts:16`.
- **Export `DefinitionChannelSchema`**: reverses a deliberate 1.0 removal that
  `public-api.test.ts:46` pins. Say why when doing it.
- **Metrics `ok`**: the removal also changes the shipped `solveMetricSinkSuite` (:61, 113-122)
  and breaks the consumer's object literal (excess property). Still a major, with more reach.
- **Considered and left**: the "would fail `HeaderAuthProvider`" point is hypothetical: the
  `userManagement:false` branch sits in `runPasswordAuthConformance`, and header-auth runs only the
  core suite. The case is still a wrong contract. `auth/interface.ts` holds six capability
  interfaces plus `IAuthProvider`, not seven. `solveCache/` is not a subpath, so it can be renamed
  in a patch. `readonly` arrays would break readers that assign them to mutable types
  (`selva/src/routes/admin/+page.server.ts:47`), not writers.
- **Splitting `access/rules.ts`**: low priority. After the gate refactor it is about 290 lines;
  `canReclaim` and `canChangeVisibilityToPublic` straddle project and org, and the Supabase RLS
  migration mirrors the file as one table.
- Registry imports sit at `registry.ts:15-27`, not 10-26.

### Order of work

- **Clamp merge in step 1** but the default (25/50/200) is decided in step 4. Move the merge after
  the decision, except Supabase `listUsers`, which has no upper clamp at all and should get one now.
- **The minor body-schema step** (re-export the three platform schemas from `bodies.ts`, wire the
  registry, export `DefinitionChannelSchema`) is not in the order at all. It belongs in step 1.
- **Binding-resolver doc fix** is not in step 1, while step 2 deletes the Noop's only test. Fix the
  docs in step 1.
- **Step 3 tightens the kit** before step 4 settles README rule 1. The review itself says to settle
  rule 1 first. Move that decision ahead of step 3.
- **`rules.test.ts`**: the architecture section moves local's file into platform; the overlap
  table keeps the matrix in local. Pick one: move it and dedupe there.

## 2. Confirmed findings

### Source: duplication

- 32-byte key check written twice (`isKey32` and `decodeSecretKey` agree on 16 inputs today).
- At-rest key loading copied into both providers.
- `trimTrailing` copies are byte-identical in platform, server and Supabase.
- Page-limit clamp re-implemented in four places; Supabase `listUsers` has no upper clamp.
- Request-body field rules repeated; channel enum re-declared twice in server.
- Hand-mirrored types (`DefinitionStatus`, `DefinitionFileExt`, `PlatformProjectGrant`,
  `SCOPE_PATTERN`).
- `MEMBER_ASSIGNABLE_PERMISSIONS` re-derived in the team members page.

### Source: logic, comments, types

- `withAdminBypass`: no production caller; wrapping `canView` reopens platform projects with the
  flag off and private projects (reproduced).
- `ProjectAccessInput.orgPermissions` read by no rule.
- `validateProjectFlags` returns two issues for one field (reproduced); no test.
- `actorFrom`/`actorOf` `system?` never read.
- `PlatformProjectGrantSchema` unused; `secretCrypto.ts` is a shim with two importers.
- Two JSDoc blocks on `markAccepted`; `mint` documents a `ttlSeconds` it does not take.
- `SolveMetric.ok` duplicates `failureKind`; the one producer writes `ok: failureKind === 'ok'`.
- `ShareLink` optional-and-nullable fields; every in-repo constructor sets all three.
- `secrets.d.ts` exposes `Buffer` with no `@types/node` declared.
- `eventSinkSuite.ts:8-12` says Local uses `NoopEventSink`; Local's test injects a recording sink.

### Public API candidates

- `withAdminBypass`, `IBindingResolver`, `NoopBindingResolver`, `SelvaConfig.bindingResolver`,
  `assertNotShareContext`, the access input types, `runPasswordAuthConformance`: no importer
  outside platform, none in the consumer's list. The parameter types stay, as the review says.
- `SeedUserFn`, `SeedUserResult`, `DefinitionTestScope` are missing from `./testing`.

### Package, scripts and config

- CI never runs `lint:types`; turbo `test`/`lint` inputs omit `packages/config`.
- `packages/config/vitest.config.js:21-24` says production resolves `import`; the selva build
  resolves `selva-source`.
- `verify-pack.mjs` asserts the three `files` exclusions; peer ranges exceed what CI runs.

### Tests

- Delete `noop-binding-resolver.test.ts` (after the binding docs are fixed).
- `scope.test.ts` matrix triplication, the expiry pass-through case, the round-trip rows.
- `slug-schema.test.ts` "reserves o" and the two merges; `image.test.ts` height parametrize (keep
  the exact-size assertion); `assetClasses.test.ts` one row; `report.test.ts:141`.
- Gaps confirmed: `assertSafeKey`, `MEMBER_ASSIGNABLE_PERMISSIONS`, `utils/audit.ts` fallback actor.

### Simplification and architecture

- OpenAPI: PATCH `/definitions/{guid}`, POST `/publish` and POST `/share-links` document no request
  body, both from registry source and from the built document (`reproduced`).
- Moving the six body schemas and the v1 DTO to server: every importer is in server or selva; the
  consumer changes one import line; no dependency cycle. `CreateOrgSchema`'s tests in
  `slug-schema.test.ts:104,108` move with it.
- `platformGate`: equivalent to today's `canView`, `canSolve`, `canEdit` and `canManage` over
  95,904 inputs; checking admin before the flag differs on 5,328 per rule, and no pure test pairs
  the flag off with an admin (`reproduced`).
- `ISolveResultCache` is named as a seam in two feature plans; `SolveMetric.ok` has no reader.
- Agreed: leave `config/report` and `snapshot`, no half-seams, keep `canEditProjectSettings`, keep
  the camelCase subpath folders, split `definitions/schemas.ts` and `context.ts`.

### Conformance kit

- Every outsider in the `ctxIsolation` cases carries `instance_admin`; Local runs no isolation
  case; Supabase does not run the grant suite.
- Bare `.rejects.toThrow()` at all listed lines, plus `eventSinkSuite.ts:247` and
  `storageProviderSuite.ts:114-115`.
- Drops confirmed: org (both, plus the merge), project "deleteProject removes" and
  "removeProjectMember deletes", grant "listByProject scopes", authProvider (all three), shareLink
  sequential cap, solveMetric actor, storage (all three).
- Dead options confirmed: `singleOrgMode`, `seedProject`, both `cleanup`s, the four-case
  `userManagement:false` branch; "createUser is undefined" would fail `HeaderAuthProvider`.
- Gaps confirmed: `scopeToOrgId`, `listPublic`, `a/b` vs `a/bc`, grant suite on `SYSTEM_CONTEXT`,
  the `< 30` cap, share-link revoke idempotency.
- apiToken "revoke is idempotent" is timing-dependent: a verifier read it as sound (a `get` runs
  between the two revokes), but rerunning the repro, an adapter that re-stamps `revokedAt` passed
  that case in 16 of 25 runs.
- `flushSink` with a synchronous sink breaks `.resolves` (reproduced in vitest); the only caller
  returns a promise today.
- Module-level `makeSeedHelpers` in two suites; `helpers.ts` returns an unused `tokens`.

## 3. New findings the review missed

### High

- **H1. A small SVG blocks every image upload for about 90 s.** `storage/image.ts:105` sets a 10 s
  sharp timeout, but librsvg renders a filter tile without checking it. Two 16 KB SVGs with
  `feTurbulence` + `feGaussianBlur` held both transcode slots for 88.5 s; an 8x8 PNG queued behind
  them finished at the same moment (`MAX_CONCURRENT_TRANSCODES` is 2). The waiter queue (`image.ts:~118`) has no bound and no
  deadline. Reach: `LocalStorageProvider.put` and `SupabaseStorageProvider.put`, from any upload
  that accepts a declared SVG (org logo). `reproduced`. Fix: refuse SVG filters and cap SVG size
  and element count before sharp, or rasterise SVG in a killable worker; cap the queue and give
  waiters a deadline (503 when full).
- **H2. An undeclared SVG is parsed in full before it is refused.** `image.ts:~85` calls
  `metadata()` with `limitInputPixels: false` and no timeout, then refuses the SVG. Two 10.4 MB
  SVGs sent as `image/png` covers were refused with 422, but peak RSS reached 1.1 GB (89 MB idle).
  Any definition editor reaches it through cover upload, which trusts the client's `File.type`.
  `reproduced`. Fix: sniff the magic bytes before sharp; accept `<` / `<?xml` only when SVG was
  declared.
- **H3. A `server`-source input takes whatever the caller posts.**
  `docs/adr/0001-pre-step-producers.md:20-22` says a `server` input is "resolved on the server at
  solve time through the host's `IBindingResolver`; never shown in the form", and the builder
  offers the kind (`plugin-ui/src/lib/features/builder/input-sources.ts:5-9`). Nothing reads `SelvaConfig.bindingResolver`.
  At solve time the server sends `values[id] ?? input.default`
  (`solve/src/server/transform-input.ts:33`), so the input solves with its default, or with any
  value a caller posts for that id. An author who marks an input `server` to keep it out of the
  caller's hands gets the opposite, silently; the Noop's doc promises a loud failure instead.
  `read-only`. Fix: until a resolver is wired, refuse a solve that posts a value for a
  `server`-kind input (or refuse schemas that use the kind); when wired, drop caller values for
  those ids before resolving.

### Medium

- **M1. The config report and the runtime disagree on the same env var.** `config/resolve.ts`
  (boot check, admin page, CLI) and `packages/server` (`compute/limits.ts:42-52`,
  `http/sign-in-age.ts:20`) parse ints with different rules. `COMPUTE_RATE_LIMIT_MAX=0.5`: the
  report says invalid and default 120; the runtime uses 0. `SIGN_IN_MAX_AGE_DAYS=1e1`: the report
  says ok; the runtime throws. The review saw the duplication but not that the admin page shows a
  value the server is not using. `reproduced`. Fix: the architecture section's `readSetting`, so
  there is one parser.
- **M2. Invites grant permissions before they are claimed.** `packages/selva/src/routes/accept-invite/+page.server.ts:~155-188`
  reads the invite once, grants `invite.platformPermissions` (which may include `instance_admin`)
  and the org membership, then calls `markAccepted`. A revoke during account creation still lands
  the grants, and the lost claim is logged as "already accepted". Outside this package, but it is
  the contract `markAccepted` exists for. `read-only`. Fix: call `markAccepted` before any grant
  and stop if it returns false.
- **M3. API-key consent text hides a read grant.** `describeApiScope('create_projects:all')`
  (`apiTokens/types.ts:105`) says "Create private projects in everything in the org", but the key
  passes `scopeAllows(ctx, 'read', ...)` for every project. The text goes into the token email and
  consent page. `SCOPE_PATTERN` also accepts `create_projects:project:p1`, which can never create
  anything and acts as `read:project:p1`. `reproduced`. Fix: say "Read and create private projects
  in"; reject `create_projects` with any resource but `all` or `org`.
- **M4. A compute API key follows its row to a new URL.** The v2 AAD binds only the server id
  (`computeServer/secrets.ts:43`). Editing the row's `serverUrl` at rest still decrypts the key and
  sends it to the new host. `enc:v1:` envelopes open under any id, and `reencryptSecrets` and
  `verifySecrets` never re-seal or report v1 rows under the current key. Needs write access to the
  store. `reproduced`. Fix: bind id and URL in a v3 envelope (the save path holds the plaintext to
  re-seal on a URL change); re-seal v1 rows and count them.
- **M5. A malformed snapshot file stops the server booting.** `boot.server.ts:115-129` casts the
  previous snapshot JSON without checking its shape and calls `diffSnapshots` outside the
  try/catch. `{}` or a file without `sensitive` throws "before.sensitive is not iterable" from the
  `init` hook. `reproduced`. Fix: validate `version`, `values` and `sensitive` in `diffSnapshots`
  (or at the read) and treat anything else as no previous snapshot.
- **M6. `<KEY>_PREVIOUS_EXPIRES` accepts dates it should refuse.** `config/previous-key.ts:29` uses
  `Date.parse`, which reads `12.1.2027` as 1 December (active 390 days, not 67), rolls
  `2026-11-31` to 1 December, and has no upper bound (`Dec 1 2099`: 26,688 days). The comment's
  rule is "a typo must not keep an old key alive". `reproduced`. Fix: accept ISO only, check the
  parsed date round-trips, cap at a multiple of the rotation window.
- **M7. A 1 x 59,000,000 PNG holds a slot past the timeout.** The pixel cap (`image.ts:93`) checks
  area only. A 1.2 MB PNG ran 12 s and came back as a generic 422 "could not be read". `reproduced`.
  Fix: cap each side (16384, WebP's limit) from the header; give a timeout its own message.
- **M8. The permission-store suite passes a self-escalating adapter.** An adapter that lets any
  user grant themselves `instance_admin` passes all 21 cases of `platformPermissionStoreSuite`.
  No case tests a self-grant or a share context. `reproduced`. Fix: add both, asserting 403.
- **M9. `url` settings accept any scheme.** `config/resolve.ts:62-67`: `ORIGIN=localhost:3000`,
  `selva.example.com:443` and `javascript:alert(1)` resolve ok with `onInvalid: 'fail'`; their
  origin is `"null"`, so the boot check passes and every form post then fails CSRF. `reproduced`.
  Fix: require `http:`/`https:`; refuse a path, query or credentials on origin keys.
- **M10. Blank and odd ints count as set.** `config/resolve.ts:70,127`: a whitespace-only value is
  set (`"  "` as an int resolves ok to 0, a required string resolves ok to `''`, and a blank new
  name hides its alias). The int parser accepts `0x10`, `0b11`, `1e3`, `+7`, `-0`. `reproduced`.
  Fix: treat `raw.trim() === ''` as unset; require `/^[+-]?\d+$/`.

### Low

- **L1. Auth suite does not pin disabled sessions.** An adapter whose `verifyToken` accepts a
  session issued before `disableUser` passes all 18 cases. `AuthUser.disabled` says verifyToken
  MUST fail; `disableUser` says sessions may live until revalidation. The two can be reconciled
  (flag vs session lifetime) but neither is tested. `reproduced`.
- **L2. `LocalShareLinkStore.revoke` ignores the caller.** The interface says `revoke` throws when
  the caller may not revoke; local lets a share context revoke someone else's link and no-ops on an
  unknown id (Supabase throws 404). The one route (`handlers/shareLinks.ts:120`) guards first, so
  only direct callers reach it. Part of the README rule-1 decision. `reproduced`.
- **L3. Snapshot hashes are guessable.** `config/snapshot.ts:40` stores `HMAC(salt, value)` with
  the salt in the same 0600 file; `Summer2026!` came back in 1,600 guesses (3.5 ms). Only for
  someone who can read the file and only for low-entropy values. `reproduced`. Fix: key the HMAC
  from a secret outside the file, or store a marker for non-generated secrets.
- **L4. GCM tag length is not pinned.** `secrets.ts:62-67`: a 4-byte tag is accepted (Node prints
  DEP0182). Weakens the tag; forgery was not shown. `reproduced`. Fix: `authTagLength: 16` and
  refuse a buffer shorter than IV plus tag.
- **L5. Non-image content types pass through untouched, case included.** `isImageUpload`
  (`image.ts:30-35`) is case-sensitive, and any non-image type passes by design: an SVG with
  `<script>` declared `IMAGE/SVG+XML` or `text/xml` is stored raw at a public `.webp` path. In-repo
  routes allowlist types first, so only direct callers of `put` reach it. `reproduced`.
- **L6. `markAccepted` accepts an expired invite** in both adapters (`LocalInviteStore.ts:87-97`,
  `SupabaseInviteStore.ts:74-85`). `getByTokenHash` hides expired invites, so only a race at the
  boundary reaches it. `read-only`.
- **L7. "bumps updatedAt" asserts `>=`** (`definitionStoreSuite.ts:267`): a store that never
  touches `updatedAt` passes. `read-only`.
- **L8. Slug edge cases.** `orgSlugFromName` returns its fallback unchecked (no in-repo caller
  passes one); `slugify('straße')` gives `stra-e`; `CreateOrgSchema` accepts a name of only
  U+200B. `reproduced`.

### Supabase adapter

Each probe ran against `packages/providers/supabase` on a local stack, one file at a time, on a
wiped database.

New findings:

- **S1 (Medium). Platform projects do not exist on Supabase, and nothing says so.**
  `SupabaseDataProvider.ts:33-34,99` wires a stub grant store whose reads, `create` and `delete`
  throw `ProviderError(501)`; the `projects_visibility_check` constraint allows only
  public/org/private. Platform's `ProjectVisibilitySchema`, `IPlatformProjectGrantStore`, the admin
  docs (`docs/self-hosting/deployment/admin.md:67`) and the `ENABLE_PLATFORM_PROJECTS` flag all
  advertise the feature with no provider caveat, and no boot check refuses the flag on Supabase.
  This is also why Supabase does not run the grant suite: 9 of its 12 cases fail with 501.
  `reproduced`. Fix: refuse the flag at boot on a provider without grants (or say so in the admin
  and provider docs), and note it on the interface.
- **S2 (Medium). `SupabaseDefinitionStore.delete` records deletions that did not happen.** It runs
  the soft-delete `update` and emits `definition.deleted` without checking that a row changed
  (`SupabaseDefinitionStore.ts:201-217`). A non-member's delete changed nothing and still emitted
  the event; so would a second delete of the same definition. Local returns early when the record
  is gone (`LocalDefinitionStore.ts:262-265`), and Supabase's own `deleteByProject` already emits
  per affected row. No kit case pins it. `reproduced`. Fix: `select('guid')` on the update and
  emit only for a returned row; add an eventSink case "deleting a missing definition emits
  nothing".
- **S3 (Low). `limit: 0` returns 100 audit rows**, not 1 as `events/audit.ts:41-42` promises.
  The upper clamp (200) and the `(occurredAt, id)` keyset paging hold, including 260 rows on three
  identical timestamps. `reproduced`.
- **S4 (Low). A share link keeps counting solves after its definition is deleted.**
  `getByTokenHash` returns null, but `getById` and `listByDefinition` still return the link and
  `tryIncrementSolveCount` returns 1. The solve path resolves by token hash first, so no in-repo
  route reaches the counter. `reproduced`.
- **S5 (Low). The permission store trusts the ctx, not the token.** With a plain user's session
  token and a ctx claiming `['instance_admin']`, `set(self, ['instance_admin'])` succeeded. This is
  the store's documented design (`SupabasePlatformPermissionStore.ts:18-19`: `user_profiles` RLS is
  too coarse, so the `assertCan*` guards are the boundary) and the ctx is built server-side, but it
  is the one store where a mis-built ctx escalates. The definition and project stores follow the
  token and ignore the ctx flag. `reproduced`.

Confirmed against Supabase (gaps in the kit, not bugs in the adapter):

- `getConfig({ scopeToOrgId })` hides the other org's server, URL and default, and equals
  `scopeConfigToOrg(getConfig(), org)`.
- `listPublic` returns only public-project definitions (drafts included, archived only on
  request); private and org-visibility ones never appear.
- `deletePrefix('a/b')` leaves `a/bc/y.txt`.
- Invites: `revoke` of an accepted invite is a no-op; `revoke` of a pending one hard-deletes it;
  `markAccepted` on an expired invite returns true (L6).
- Share links: `getById` returns revoked and expired links; an unknown id on `revoke` is a 404; a
  non-member's revoke is a 404 (RLS hides the row) and changes nothing.
- API tokens: a second revoke 50 ms later keeps the first `revokedAt` and emits nothing;
  `revokeAllForUser` leaves already-revoked tokens out.
- Every `SolveFailureKind` on both channels persists; there is no CHECK constraint (the migration
  comment lists seven kinds and omits `shed`).
- Permission store: a plain user's self-grant is a 403 (M8 holds for Supabase); a share ctx gets
  403 from `set`, `getFor` and `getForBatch`.
- README rule 2 holds for Supabase's definition and project stores: a non-member's `get` returns
  null, `update` and `updateProject` are 404s and change nothing (except S2's event).
- Disabled users: a pre-disable session verifies for up to 60 s (`revalidateMs`), then fails;
  `tokenVerification: 'strict'` fails at once. This matches `disableUser`'s doc (L1).
- `listUsers({ limit: 5000 })` sends `perPage: 5000` unclamped; `0` makes GoTrue answer 500 and
  `-1` "Bad Pagination Parameters".
- An `enc:v1:` row under the current key: `verifySecrets` reports ok and does not flag it,
  `reencryptSecrets` leaves it v1; only a save rewrites it as v2 (M4).
- `recordRun` keeps exactly `MAX_RECENT_RUNS` (20), newest first.

## 4. Decisions that still need a human

- **Where request bodies live.** Recommend the minor now (server re-exports the three schemas and
  the registry documents them), the move at the next major.
- **Binding resolver.** Recommend closing H3 now (refuse caller values for `server`-kind ids) and
  fixing the docs, then checking saved schemas for the kind: if none use it, remove the seam and
  the kind at the major with a migrator; otherwise wire it.
- **README rules 1 and 2 ("adapters MUST filter by ctx", "stores stay safe if the caller skipped
  the rules").** Local's definition, org, project and share-link stores do neither; the server
  guards do. Supabase's do, through RLS on the session token, except the permission store, which
  trusts the ctx (S5). Recommend rewriting both rules to say which adapters enforce in the store and
  pointing at the existing `ctxIsolation` option, before any kit tightening.
- **Platform projects on Supabase.** Recommend refusing `ENABLE_PLATFORM_PROJECTS` at boot when
  the provider's grant store is the stub, and saying so in the admin docs, rather than
  implementing grants now.
- **Kit tightening in a minor.** Recommend: outsider ctx fix as a patch (ctxIsolation is opt-in),
  every other stricter case behind a named option, defaults flipped at the major.
- **SVG uploads.** Recommend refusing SVG filters and sniffing bytes before sharp (H1, H2), not a
  worker: cheaper, and covers H2 too.
- **Page-limit defaults.** Recommend one default (`DEFAULT_PAGE_LIMIT`) everywhere and keep 200
  only where it was deliberate (admin orgs); clamp Supabase `listUsers` now (it forwards 5000 to
  GoTrue, and 0 makes GoTrue fail).
- **`public-api.test.ts` reintroduction guard.** Recommend keeping only the root-barrel crypto
  case: re-adding an export is a reviewed edit.

## 5. Appendix: repro scripts

Each runs with `node` from a folder holding `platform-dist` (a `tsc --outDir` build of
`packages/platform`) and a `node_modules` linked to the package's own. `REPO` is the repo root.

H1, SVG holds the slot:

```js
import sharp from 'sharp';
import { transcodeImageIfNeeded as tx } from './platform-dist/storage/index.js';
const rects = Array.from(
	{ length: 250 },
	(_, i) => `<rect x="${i}" y="${i}" width="900" height="900" filter="url(#f)"/>`
).join('');
const svg = Buffer.from(
	`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200"><filter id="f" x="-1" y="-1" width="3" height="3"><feTurbulence baseFrequency="0.05" numOctaves="8"/><feGaussianBlur stdDeviation="40"/></filter>${rects}</svg>`
);
const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#0f0' } })
	.png()
	.toBuffer();
const t = Date.now(),
	log = (s) => (r) => console.log(s, Date.now() - t, 'ms', r?.message ?? 'ok');
for (const i of [1, 2])
	tx(svg, 'image/svg+xml', 'orgs/a/branding/logo.svg').then(log(`svg${i}`), log(`svg${i}`));
await tx(png, 'image/png', 'definitions/x/cover.png').then(log('tiny png'), log('tiny png'));
```

H2, undeclared SVG parsed in full (run under `/usr/bin/time -l` for peak RSS):

```js
import { transcodeImageIfNeeded as tx } from './platform-dist/storage/index.js';
const svg = Buffer.from(
	`<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">${'<rect width="1" height="1"/>'.repeat(370_000)}</svg>`
);
const r = await Promise.allSettled(
	[1, 2].map(() => tx(svg, 'image/png', 'definitions/x/cover.webp'))
);
console.log(JSON.stringify(r.map((x) => [x.reason?.statusCode, x.reason?.message])));
```

M1, report vs runtime (needs `packages/server` built):

```js
import { resolveConfig } from './platform-dist/config/index.js';
const SRV = `${process.env.REPO}/packages/server/dist`;
const { ENGINE_SETTINGS } = await import(`${SRV}/config/settings.js`);
const { resolveComputeLimits } = await import(`${SRV}/compute/limits.js`);
const { resolveSignInMaxAgeMs } = await import(`${SRV}/http/sign-in-age.js`);
const show = (key, raw, run) => {
	const k = resolveConfig(ENGINE_SETTINGS, { [key]: raw }).keys[key];
	let r;
	try {
		r = run({ [key]: raw });
	} catch (e) {
		r = 'THROWS ' + e.message.slice(0, 40);
	}
	console.log(key, JSON.stringify(raw), '| report:', k.status, k.value, '| runtime:', r);
};
show('COMPUTE_RATE_LIMIT_MAX', '0.5', (e) => resolveComputeLimits(e).rateLimitMaxRequests);
show('SIGN_IN_MAX_AGE_DAYS', '1e1', resolveSignInMaxAgeMs);
```

M3, consent text:

```js
import {
	narrowApiTokenContext,
	scopeAllows,
	describeApiScope
} from './platform-dist/apiTokens/index.js';
const live = { userId: 'u', actingOrgId: 'o', platformPermissions: [], orgPermissions: [] };
const t = (s) =>
	narrowApiTokenContext(live, {
		id: 't',
		orgId: 'o',
		scopes: [s],
		expiresAt: '2099-01-01T00:00:00Z'
	});
console.log(
	describeApiScope('create_projects:all'),
	'| reads any project:',
	scopeAllows(t('create_projects:all'), 'read', { projectId: 'p', definitionId: 'd' })
);
const p = t('create_projects:project:p1');
console.log(
	'creates:',
	scopeAllows(p, 'create_projects'),
	'| reads p1:',
	scopeAllows(p, 'read', { projectId: 'p1' })
);
```

M4, AAD binds the id only:

```js
import { encryptSecret, decryptWithKeys } from './platform-dist/computeServer/index.js';
const keys = [Buffer.alloc(32, 1)];
const row = {
	id: 'srv-1',
	serverUrl: 'https://compute.internal',
	apiKey: encryptSecret('rhino-secret', keys[0], 'srv-1')
};
const tampered = { ...row, serverUrl: 'https://attacker.example' };
console.log('url swapped ->', decryptWithKeys(tampered.apiKey, keys, tampered.id).plaintext);
console.log(
	'v1 under srv-2 ->',
	decryptWithKeys(encryptSecret('rhino-secret', keys[0]), keys, 'srv-2').plaintext
);
```

M5, snapshot shape:

```js
import { takeSnapshot, diffSnapshots } from './platform-dist/config/index.js';
const manifest = [
	{ key: 'PORT', type: 'int', onInvalid: 'fail', class: 'bootstrap', description: '' }
];
for (const prev of [{}, { version: 1, salt: 'abc' }]) {
	const next = takeSnapshot(manifest, { PORT: '3000' }, prev.salt);
	try {
		console.log(diffSnapshots(prev, next));
	} catch (e) {
		console.log(JSON.stringify(prev), 'THROWS', e.message);
	}
}
```

M6, previous-key expiry:

```js
import { previousKey } from './platform-dist/config/index.js';
const now = Date.parse('2026-11-06T00:00:00Z');
for (const exp of ['2027-01-12', '12.1.2027', '2026-11-31', 'Dec 1 2099']) {
	const p = previousKey({ K_PREVIOUS: 'old', K_PREVIOUS_EXPIRES: exp }, 'K', now);
	console.log(exp, p.state, p.daysLeft ?? '');
}
```

M7, tall PNG:

```js
import sharp from 'sharp';
import { transcodeImageIfNeeded } from './platform-dist/storage/index.js';
const png = await sharp({
	create: { width: 1, height: 59_000_000, channels: 3, background: '#f00' }
})
	.png()
	.toBuffer();
const t = Date.now();
await transcodeImageIfNeeded(png, 'image/png', 'orgs/a/branding/logo.png').catch((e) =>
	console.log(e.message)
);
console.log('ms', Date.now() - t);
```

M8, self-granting permission adapter (vitest; needs `packages/providers/local` built):

```js
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { runPlatformPermissionStoreConformance } from './platform-dist/testing/index.js';
const L = `${process.env.REPO}/packages/providers/local/dist`;
const { LocalPlatformPermissionStore } = await import(`${L}/permissions/index.js`);
const { createLocalUserDataStore } = await import(`${L}/data/userData.js`);
class SelfGrant extends LocalPlatformPermissionStore {
	set(ctx, userId, p) {
		return super.set(ctx.userId === userId ? { ...ctx, system: true } : ctx, userId, p);
	}
}
runPlatformPermissionStoreConformance({
	name: 'self-grant adapter',
	createStore: async () => {
		const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'perm-')), 'u.json');
		const ud = createLocalUserDataStore(f);
		return {
			store: new SelfGrant(f),
			seedUser: async () => {
				const id = randomUUID();
				await ud.ensure(id);
				return id;
			}
		};
	}
});
```

M9 and M10, config parsing:

```js
import { resolveConfig } from './platform-dist/config/index.js';
const url = { key: 'ORIGIN', type: 'url', onInvalid: 'fail', class: 'bootstrap', description: '' };
for (const raw of ['localhost:3000', 'javascript:alert(1)'])
	console.log(raw, resolveConfig([url], { ORIGIN: raw }).keys.ORIGIN.status);
const int = {
	key: 'X',
	type: 'int',
	min: 0,
	default: 60,
	onInvalid: 'fail',
	class: 'tunable',
	description: ''
};
for (const raw of ['  ', '0x10', '1e3', '+7']) {
	const k = resolveConfig([int], { X: raw }).keys.X;
	console.log(JSON.stringify(raw), k.status, k.value);
}
```

L4, short GCM tag:

```js
import { encryptSecret, decryptSecret } from './platform-dist/computeServer/index.js';
const key = Buffer.alloc(32, 7);
const full = Buffer.from(encryptSecret('', key, 'srv-1').slice(7), 'base64');
console.log(
	JSON.stringify(decryptSecret('enc:v2:' + full.subarray(0, 16).toString('base64'), key, 'srv-1'))
);
```

Review claim, `withAdminBypass` reopens content:

```js
import { withAdminBypass, canView } from './platform-dist/access/index.js';
const admin = ['instance_admin'];
const input = {
	orgPermissions: [],
	platformPermissions: admin,
	member: null,
	orgMember: null,
	project: { id: 'p', orgId: 'o', visibility: 'platform', autoJoinOnUpload: false },
	allowCrossOrgPublic: false,
	enablePlatformProjects: false,
	platformGrants: [],
	actingOrgId: 'o',
	userId: 'a'
};
console.log(
	'canView',
	canView(input),
	'| wrapped',
	withAdminBypass(admin, () => canView(input))
);
```

Review claim, apiToken revoke idempotency passes a re-stamping adapter (vitest, run several times):

```js
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runApiTokenStoreConformance } from './platform-dist/testing/index.js';
const { LocalApiTokenStore } = await import(
	`${process.env.REPO}/packages/providers/local/dist/data/index.js`
);
class Bad extends LocalApiTokenStore {
	async revoke(_c, id) {
		await this.locked(async () => {
			const f = await this.load();
			const t = f.tokens.find((x) => x.id === id);
			if (t) t.revokedAt = new Date().toISOString();
			await this.save(f);
		});
	}
}
for (let i = 0; i < 5; i++)
	runApiTokenStoreConformance({
		name: `re-stamp #${i}`,
		createStore: () => new Bad(fs.mkdtempSync(path.join(os.tmpdir(), 'tok-')))
	});
```

S2, Supabase records a delete that changed nothing (vitest, run against a local stack; imports
the provider's `src/data/__tests__/test-helpers.ts`):

```ts
const env = readEnv()!;
const owner = await seedUser(env, ''),
	plain = await seedPlainUser(env, '');
const orgId = await seedOrg(owner.userId); // insert into selva.orgs + org_members
const proj = await seedProject(orgId, owner.userId, 'private');
const def = await seedDef(proj.id, owner.userId);
const events: string[] = [];
const defs = new SupabaseDefinitionStore(env.bundle, {
	emit: async (e) => void events.push(e.type)
});
const ctx = {
	userId: plain.userId,
	platformPermissions: [],
	orgPermissions: [],
	adapterContext: { sessionToken: plain.sessionToken }
};
await defs.delete(ctx, def.guid);
const row = (
	await env.adminClient.from('definitions').select('deleted_at').eq('guid', def.guid).single()
).data;
console.log('deleted_at', row?.deleted_at, '| events', events); // null | ['definition.deleted']
```
