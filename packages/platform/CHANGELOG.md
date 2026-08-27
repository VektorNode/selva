# @selvajs/platform

## 0.20.1

### Patch Changes

- f763878: Document that `GuidSchema` is the prototype-pollution guard for the definition stores.

  The stores index plain objects by guid (`config.definitions[guid]`), so the UUID regex is
  load-bearing beyond format validation: it is what keeps `__proto__` and `constructor` out of
  a key position. `LocalDefinitionStore.live()` does not stop a prototype lookup on its own —
  `definitions['__proto__']` returns `Object.prototype`, whose `deletedAt` is undefined, so it
  passes as a live record and the caller's `Object.assign` writes onto the prototype.

  Comments only; no behavior change. Both are noted at the point a future entry point would
  have to preserve the invariant.

## 0.20.0

### Minor Changes

- 4d16b79: Outbound mail moves behind an `INotificationProvider` seam

  Selva had two mail systems that did not know about each other: GoTrue owned magic
  links, and `$lib/server/email/` owned invites — one renderer wired straight to
  nodemailer, living inside the app. Neither is wrong alone, but the next message
  (a failed solve, a shared project) had nowhere to go except a third path, and
  then every mail Selva sends looks different and obeys different rules.

  `@selvajs/platform/notifications` adds the transport interface —
  `INotificationProvider`, `OutboundMessage`, `SendResult`, `NotificationKind`, and
  a `NoopNotificationProvider` for instances that send nothing. `send` must not
  throw: by the time it runs the invite row is already committed and the caller
  still holds the accept URL, so a dead SMTP host must not turn a successful write
  into a failed request. `not-configured` stays distinct from `failed` because an
  instance with no mail server is a supported deployment, not a broken one.

  `@selvajs/server/notifications` adds `SmtpNotificationProvider`, a lift of the
  app's old mailer with nodemailer as an optional peer. `readSmtpConfig` now takes
  an env bag rather than importing SvelteKit's `$env/dynamic/private` — the
  provider lives outside the app, and under `vite dev` Vite does not mirror `.env`
  into `process.env`, so a provider reading it directly would ignore every
  override.

  Templates move to a new private `@selvajs/notifications`, where they are pure
  render with no I/O, no env and no transport. One shared layout wrapper and one
  `escapeHtml` replace the per-file copies.

  No behaviour change: same mail, same SMTP settings, same fallback to sharing an
  invite link by hand when mail is off.

## 0.19.1

### Patch Changes

- 6fa6b27: Add ESLint configs and lint scripts. Build output and published files are unchanged.
- Updated dependencies [6fa6b27]
  - @selvajs/schemas@5.0.1

## 0.19.0

### Minor Changes

- e779034: Make the first-admin bootstrap atomic, so "first signer wins" is true under concurrency.

  `bootstrapUserSession` asked `hasInstanceAdmin()` and then called `set()` — two
  round-trips with nothing holding the gap. On a single-tenant install with no
  `BOOTSTRAP_INSTANCE_ADMIN_EMAIL` configured, `shouldBootstrapAdmin` returns true
  for _any_ signer, so two different people signing in at the same moment both
  observed "no admin yet" and both were granted every platform permission,
  permanently. Permissions.md §2 promises the first signer wins; it was aspiration.

  `IPlatformPermissionStore` gains `claimFirstInstanceAdmin(ctx, userId,
permissions)`, which grants only if no enabled `instance_admin` exists and
  returns whether this call was the one that claimed it. It is the mirror of the
  sole-admin invariant already enforced in `set`: that one refuses to drop the
  _last_ admin, this one refuses to create a _second first_ admin.

  Supabase implements it as a `SECURITY DEFINER` RPC
  (`selva.claim_first_instance_admin`) taking a transaction-scoped advisory lock,
  then re-reading inside it. There is no row to lock — the whole point is that no
  admin row exists yet — so the `for update` approach used for the last-admin
  invariant does not apply here, and a bare `not exists` in the `UPDATE` predicate
  would not work either: under READ COMMITTED both racers read the snapshot taken
  when their statement began and both see an empty set. A caller that blocks on
  the advisory lock re-reads after the winner commits and correctly loses.

  Local shares the existing promise-chain mutex with `updatePermissionsGuarded`,
  deliberately: the two decide the same question from opposite ends, so they must
  not interleave with each other any more than with themselves.

  `platformPermissionStoreSuite` gains two cases — a sequential claim-then-refuse,
  and a four-way concurrent burst asserting exactly one admin results. Both
  adapters are pinned to the same contract.

  Supabase deployments need the new migration
  (`20260817200000_atomic_first_admin_claim.sql`); `EXPECTED_MIGRATION_HEAD` moves
  with it, so a stale database fails the startup check rather than silently
  running the old path.

- e779034: Make the sole-`instance_admin` invariant atomic in both providers.

  `set` checked the surviving-admin count and wrote in two steps with nothing
  holding the gap. Two admins demoting each other at the same moment each observed
  the other as "another admin exists", both passed, and both committed — leaving
  zero instance admins and an instance that can no longer be administered through
  the UI. Permissions.md §2 states the invariant as absolute; it was not.

  Supabase moves the check inside a `SECURITY DEFINER` RPC
  (`selva.set_platform_permissions`) that locks the target row and then the
  surviving admin rows with `for update`, so concurrent demotions serialize
  instead of racing. A bare `exists` in the `UPDATE` predicate is not sufficient
  under READ COMMITTED — the subquery reads the statement's snapshot — and the
  conformance suite fails without the explicit locks.

  Local serializes guarded permission writes through a promise-chain mutex and
  counts inside the critical section, matching the single-process boundary its
  load-once cache already assumes.

  `platformPermissionStoreSuite` gains two concurrency cases (a mutual demotion of
  two admins, and a four-way burst) so both adapters are pinned to the same
  contract: exactly one demotion wins and `hasInstanceAdmin` stays true.

- e779034: Give the org-owner boundary one predicate instead of three hand-written copies.

  Three routes decided whether an actor may grant or revoke org `owner`/`admin`
  standing — minting an invite, changing a member's role, and removing an owner —
  and each spelled the rule out longhand. Two had already drifted: the invite route
  let an admin mint themselves an `owner` invite, and member `DELETE` removed an
  owner that `PATCH` would not let them demote. The unguarded operation was the
  harder one to reverse; a demoted owner can be re-promoted, a removed one has lost
  every project membership to the cascade.

  `canChangeOrgRole({ actorMember, role })` now lives in `rules.ts` beside the
  project predicates, and all three routes call it. It reads the **membership
  row**, never `Organization.ownerId` — those are separate fields that can
  disagree, and only the row is authority here.

  One tightening falls out of the consolidation: the role-change branch of `PATCH
/api/v1/orgs/{orgId}/members/{userId}` now gates on both the role being granted
  and the role being taken away. Demoting an owner crosses the boundary even though
  granting `member` does not, and the old code checked only the target role.

  The point is not the deduplication. Changing that single predicate to admit
  admins turns **nine** route tests red across all three files plus two rule tests,
  from one edit — previously, breaking the rule in one route left the other two
  silently green, which is exactly how it drifted twice.

- e779034: Report projects left without an owner when an org member is removed, instead of orphaning them silently.

  `removeOrgMember` cascades every `project_members` row, so removing someone who
  was the only owner of a project left that project with nobody able to manage it —
  no settings, no roster, no delete — and nothing anywhere said so.

  Permissions.md §10 promised the removal would be **blocked** until a new owner was
  assigned. That rule is retired rather than implemented. Blocking makes the cost of
  offboarding scale with how many projects the departing person owned, which is
  backwards: the most prolific people are the ones whose departure most needs to be
  clean, and an offboarding that stalls halfway leaves a live account in the org
  while someone works through the backlog. Auto-transfer was rejected separately —
  it hands someone authority silently, by a heuristic nobody remembers, and six
  months later the audit log cannot explain why they own it.

  `DELETE /api/v1/orgs/{orgId}/members/{userId}` now emits
  `org_member.removed_orphaning_projects` carrying every affected project id in one
  event, rather than one event each: an admin reading the log wants "this
  offboarding cost three projects", not three rows to correlate. Reclaim already
  adopts an ownerless project, so the recovery path predates the problem — what was
  missing was any signal that recovery was needed.

  The check runs **before** the removal, because the cascade soft-deletes the very
  rows it reads. In the other order it finds no owners, concludes nothing was
  orphaned, and reports nothing on precisely the case it exists for — so that
  ordering has its own test.

## 0.18.0

### Minor Changes

- 679a24f: Invites carry instance permissions; admins no longer set another user's password.

  Creating a user had two shapes depending on the provider: an admin typed someone
  else's password (Local, Supabase), or allowlisted an email and let the IdP hold
  the credential (header-auth/Entra). The first is now gone. A provider that owns
  credentials admits users by invite, so the account holder is the only party who
  ever chooses their password.

  That removal needed a replacement first: the admin-sets-password form was the
  only way to create a second instance admin, so deleting it alone would have left
  a deployment stuck with the admin it bootstrapped with. Invites now carry
  `platformPermissions`, mintable only by a caller who already holds
  `instance_admin` — `manage_org_members` is enough to invite people, so without
  that check an org admin could mint themselves an admin invite and accept it.

  The allowlist path (`createUser`) is untouched — it is the only way into a
  header-auth deployment, and it is now the sole branch of `POST /api/admin/users`.
  The local provider implements no `createUser`, so that route reports 501 there
  and points at invites; the admin UI hides the form to match.

  In the invite form, platform permissions render as their own group. The
  owner/admin role lock renders a checkbox as checked-and-disabled, and reusing it
  across scopes would have granted `instance_admin` to every owner invite.

  Requires `supabase db push` — adds `selva.invites.platform_permissions`.

## 0.17.0

### Minor Changes

- 4512068: The supported Node floor moves from 22 to 24.

  Node 24 ("Krypton") is the active LTS; Node 22 leaves maintenance in April 2027. Every package's
  `engines.node` is now `>=24.0.0`, and CI builds and tests on 24 instead of 22.

  **This is visible to operators before it is visible to anyone else.** `@selvajs/cli` derives its
  floor from its own `engines.node` rather than a literal, so `selva doctor` and the create-time
  guard follow the bump automatically: a deployment running Node 22 that passed `doctor` yesterday is
  reported as out of range today. Nothing about the deployment changed — the floor moved under it.
  Upgrade the host's runtime before taking this version of the CLI.

  The admin UI's update check reports the same thing from the other direction: it compares the
  running Node against the `engines.node` of the release it fetched from npm, so it starts flagging a
  Node 22 host as soon as a `>=24` version is published, with no client-side change at all.

  No source change was needed. The Node builtins in use are long-stable (`fs`, `path`, `crypto`,
  `url`, `os`, `net`, `zlib`), there are no experimental APIs or `--experimental` flags in the tree,
  and every dependency's own engine range already admitted 24.

### Patch Changes

- 4512068: Clean up published tarballs. The monorepo-internal `source` export condition is renamed to `selva-source` so it can never collide with a consumer resolving the common `source` condition; published packages no longer ship raw `src/` TypeScript or compiled test files. Publish-time manifest rewriting is gone — the committed package.json is what ships, gated by `publint --strict` and a tarball contents check.
- 4512068: Unify the vitest setup across the workspace behind `@selvajs/config/vitest`.

  Packaging fix: `@selvajs/compute`, `@selvajs/solve`, `@selvajs/visualization`
  and `@selvajs/schemas` had no test-file exclusion in `files`, so a change of
  build tool would have shipped tests to npm. All publishable packages now carry
  the same exclusion.

  `@selvajs/platform`'s test suite was never wired to a runner and had never
  executed; it now runs with the rest.

- Updated dependencies [4512068]
- Updated dependencies [4512068]
- Updated dependencies [4512068]
- Updated dependencies [4512068]
- Updated dependencies [4512068]
  - @selvajs/schemas@5.0.0

## 0.17.0-beta.3

### Minor Changes

- 39db6f5: The supported Node floor moves from 22 to 24.

  Node 24 ("Krypton") is the active LTS; Node 22 leaves maintenance in April 2027. Every package's
  `engines.node` is now `>=24.0.0`, and CI builds and tests on 24 instead of 22.

  **This is visible to operators before it is visible to anyone else.** `@selvajs/cli` derives its
  floor from its own `engines.node` rather than a literal, so `selva doctor` and the create-time
  guard follow the bump automatically: a deployment running Node 22 that passed `doctor` yesterday is
  reported as out of range today. Nothing about the deployment changed — the floor moved under it.
  Upgrade the host's runtime before taking this version of the CLI.

  The admin UI's update check reports the same thing from the other direction: it compares the
  running Node against the `engines.node` of the release it fetched from npm, so it starts flagging a
  Node 22 host as soon as a `>=24` version is published, with no client-side change at all.

  No source change was needed. The Node builtins in use are long-stable (`fs`, `path`, `crypto`,
  `url`, `os`, `net`, `zlib`), there are no experimental APIs or `--experimental` flags in the tree,
  and every dependency's own engine range already admitted 24.

### Patch Changes

- Updated dependencies [39db6f5]
  - @selvajs/schemas@5.0.0-beta.3

## 0.16.1-beta.2

### Patch Changes

- a011c5e: Unify the vitest setup across the workspace behind `@selvajs/config/vitest`.

  Packaging fix: `@selvajs/compute`, `@selvajs/solve`, `@selvajs/visualization`
  and `@selvajs/schemas` had no test-file exclusion in `files`, so a change of
  build tool would have shipped tests to npm. All publishable packages now carry
  the same exclusion.

  `@selvajs/platform`'s test suite was never wired to a runner and had never
  executed; it now runs with the rest.

- Updated dependencies [0629321]
- Updated dependencies [a011c5e]
  - @selvajs/schemas@5.0.0-beta.2

## 0.16.1-beta.1

### Patch Changes

- 0e2c428: Clean up published tarballs. The monorepo-internal `source` export condition is renamed to `selva-source` so it can never collide with a consumer resolving the common `source` condition; published packages no longer ship raw `src/` TypeScript or compiled test files. Publish-time manifest rewriting is gone — the committed package.json is what ships, gated by `publint --strict` and a tarball contents check.
- Updated dependencies [0e2c428]
  - @selvajs/schemas@5.0.0-beta.1

## 0.16.1-beta.0

### Patch Changes

- Updated dependencies [5292563]
  - @selvajs/schemas@5.0.0-beta.0

## 0.16.0

### Minor Changes

- efb003a: Add `ISessionRefresh` — session refresh + server-side revoke

  Session lifecycle now has its own capability, `IAuthProvider.sessionRefresh`,
  holding `refreshSession` and a new `revokeSession`.

  **Why it moved off `IOAuthAuth`.** Refresh and revoke are properties of a
  _session_, not of OAuth. A deployment that brokers no OAuth
  (`oauth.listProviders()` → `[]`) still needs to revoke on logout, and
  previously had to reach into an OAuth capability whose stated precondition it
  did not meet — which worked only because the Supabase adapter constructs its
  OAuth surface unconditionally.

  **`revokeSession` is new behaviour, not a move.** Nothing in the tree could
  invalidate a session server-side. Logout deleted the cookie and the JWT stayed
  valid until natural expiry, so a copy captured elsewhere kept working after the
  user believed they had signed out. The Supabase adapter implements it via
  GoTrue's `admin.signOut(jwt, 'global')`, signing out every session for that
  user rather than only the one the token names.

  It is best-effort and idempotent: revoking an already-revoked, expired, or
  unknown token returns `true` (the desired end state holds), and it never
  throws — a failed revoke must not stop a user from logging out. `false` means
  the session may still be live.

  `IOAuthAuth.refreshSession` is **deprecated but still works**, delegating to the
  new surface for one release. Migrate callers to
  `auth.sessionRefresh?.refreshSession(...)`; it will be removed in the next minor.

  Also corrects `disableUser`'s doc comment, which claimed "Sessions become
  invalid". Disabling sets the metadata flag; adapters verifying tokens locally
  keep accepting an already-issued access token until their next revalidation
  (the Supabase adapter bounds this by `revalidateMs`, default 60s). Callers
  needing immediate cutoff should also call `sessionRefresh.revokeSession`.

## 0.15.0

### Minor Changes

- 5077fe9: Adding advanced caching
- b8607d4: Export the structured logging contract from the platform barrel: `ILogger`,
  `LogLevel`, `LogFields`, and the `NoopLogger` default (from
  `./logging/interface.js`).

  These types were added to the platform source with the Pino structured-logging
  work (request ID correlation), but that commit carried no `@selvajs/platform`
  changeset — so the published `0.15.0-beta.1` tarball (released three days
  earlier) predates them entirely. Meanwhile `@selvajs/server@0.2.0-beta.5` was
  published importing `NoopLogger` from `@selvajs/platform` with a
  `^0.15.0-beta.1` dependency, so any consumer installing server beta.5 from npm
  fails at module load with `SyntaxError: The requested module '@selvajs/platform'
does not provide an export named 'NoopLogger'`. This release publishes the
  logging interface so server beta.5's existing dependency range resolves a
  platform build that actually ships the export — no server republish required.

- 243ae19: Export the durable L2 solve-result cache contract from the platform barrel:
  `ISolveResultCache`, `SolveCacheKey`, `SolveCacheSetOptions`, and the
  `NoopSolveResultCache` default (from `./solveCache/interface.js`).

  These types already lived in the platform source (added with the advanced-caching
  work) but were never carried by a platform release — the `quiet-snakes-press`
  changeset bumped `@selvajs/server`/`@selvajs/selva`/`@selvajs/ui` but not
  `@selvajs/platform`. As a result the published `@selvajs/platform@0.14.3-beta.0`
  tarball shipped no `solveCache` files, while `@selvajs/server@0.2.0-beta.3`'s
  `memory-solve-cache` d.ts does `import type { ISolveResultCache } from
'@selvajs/platform'` — so a consumer that imports `createMemorySolveResultCache`
  fails to typecheck against the published platform. This release publishes the
  interface so the server package's L2 backend resolves its type contract.

- a8e1b47: Export two utilities that had no publishable engine home, so downstream apps can share them instead of re-implementing them.

  - `@selvajs/platform` now exports `slugify(name)` alongside `SlugSchema` (in `organizations/schemas.ts`, re-exported from the org and root barrels). It coerces an arbitrary name into the shape `SlugSchema` validates — lowercase, non-alphanumeric runs collapsed to single hyphens, edge hyphens trimmed, capped at 63 chars — but does not itself guarantee validity (an all-symbol name yields `''` and reserved words pass through), so callers must still run the result through `SlugSchema`. The Selva app's private `server/slug.ts` copy is deleted and its six importers repoint to the package.
  - `@selvajs/schemas` now exports `getDefaultValue(paramType)` (the value an input carries when the schema supplies no explicit default), moved from `@selvajs/ui`'s `schema/defaults` so server-side callers can share it without pulling in the UI package. `@selvajs/ui/schema/defaults` keeps working as a thin re-export, so existing UI consumers are unaffected.

### Patch Changes

- Updated dependencies [5077fe9]
- Updated dependencies [2673995]
- Updated dependencies [a8e1b47]
  - @selvajs/schemas@4.7.0

## 0.15.0-beta.4

### Minor Changes

- Adding advanced caching

### Patch Changes

- Updated dependencies
  - @selvajs/schemas@4.7.0-beta.2

## 0.15.0-beta.3

### Minor Changes

- a8e1b47: Export two utilities that had no publishable engine home, so downstream apps can share them instead of re-implementing them.

  - `@selvajs/platform` now exports `slugify(name)` alongside `SlugSchema` (in `organizations/schemas.ts`, re-exported from the org and root barrels). It coerces an arbitrary name into the shape `SlugSchema` validates — lowercase, non-alphanumeric runs collapsed to single hyphens, edge hyphens trimmed, capped at 63 chars — but does not itself guarantee validity (an all-symbol name yields `''` and reserved words pass through), so callers must still run the result through `SlugSchema`. The Selva app's private `server/slug.ts` copy is deleted and its six importers repoint to the package.
  - `@selvajs/schemas` now exports `getDefaultValue(paramType)` (the value an input carries when the schema supplies no explicit default), moved from `@selvajs/ui`'s `schema/defaults` so server-side callers can share it without pulling in the UI package. `@selvajs/ui/schema/defaults` keeps working as a thin re-export, so existing UI consumers are unaffected.

### Patch Changes

- Updated dependencies [a8e1b47]
  - @selvajs/schemas@4.7.0-beta.1

## 0.15.0-beta.2

### Minor Changes

- b8607d4: Export the structured logging contract from the platform barrel: `ILogger`,
  `LogLevel`, `LogFields`, and the `NoopLogger` default (from
  `./logging/interface.js`).

  These types were added to the platform source with the Pino structured-logging
  work (request ID correlation), but that commit carried no `@selvajs/platform`
  changeset — so the published `0.15.0-beta.1` tarball (released three days
  earlier) predates them entirely. Meanwhile `@selvajs/server@0.2.0-beta.5` was
  published importing `NoopLogger` from `@selvajs/platform` with a
  `^0.15.0-beta.1` dependency, so any consumer installing server beta.5 from npm
  fails at module load with `SyntaxError: The requested module '@selvajs/platform'
does not provide an export named 'NoopLogger'`. This release publishes the
  logging interface so server beta.5's existing dependency range resolves a
  platform build that actually ships the export — no server republish required.

## 0.15.0-beta.1

### Minor Changes

- Export the durable L2 solve-result cache contract from the platform barrel:
  `ISolveResultCache`, `SolveCacheKey`, `SolveCacheSetOptions`, and the
  `NoopSolveResultCache` default (from `./solveCache/interface.js`).

  These types already lived in the platform source (added with the advanced-caching
  work) but were never carried by a platform release — the `quiet-snakes-press`
  changeset bumped `@selvajs/server`/`@selvajs/selva`/`@selvajs/ui` but not
  `@selvajs/platform`. As a result the published `@selvajs/platform@0.14.3-beta.0`
  tarball shipped no `solveCache` files, while `@selvajs/server@0.2.0-beta.3`'s
  `memory-solve-cache` d.ts does `import type { ISolveResultCache } from
'@selvajs/platform'` — so a consumer that imports `createMemorySolveResultCache`
  fails to typecheck against the published platform. This release publishes the
  interface so the server package's L2 backend resolves its type contract.

## 0.14.3-beta.0

### Patch Changes

- Updated dependencies [2673995]
  - @selvajs/schemas@4.7.0-beta.0

## 0.14.2

### Patch Changes

- Updated dependencies [3ca77a5]
  - @selvajs/schemas@4.6.1

## 0.14.1

### Patch Changes

- Updated dependencies [fd2bb4f]
  - @selvajs/schemas@4.6.0

## 0.14.0

### Minor Changes

- fed3a9e: Capture per-solve timing and outcome telemetry.
  - **platform**: new pluggable `ISolveMetricSink` provider (`SelvaConfig.solveMetrics`, defaults to `NoopSolveMetricSink`). A `SolveMetric` records the solve's wall-clock `durationMs`, `ok`, a `failureKind` (`timeout` | `client_abort` | `rate_limited` | `share_cap` | `too_large` | `compute_error` | `ok`), Grasshopper `errorCount`/`warningCount`, and attribution: `definitionId` + `versionId` (so timings compare across definition versions), `orgId`, and `channel`. Adds the `runSolveMetricSinkConformance` testing suite.
  - **supabase-provider**: `SupabaseSolveMetricSink` persists every solve to the new `selva.solve_metrics` table (with the triggering user in `actor_id`). Exposed off `SupabaseDataProvider` so it wires automatically when the Supabase data provider is selected. Includes the migration and a conformance test.
  - **selva**: the compute route now records one metric per solve attempt — including attempts rejected before the solve runs (rate limit, share-link cap) — and distinguishes a genuine solve timeout from a client disconnect. A successful solve of a local definition also bumps that definition's `solveCount` (the "N runs" stat shown on definition cards/lists), which was previously never incremented.

## 0.13.0

### Minor Changes

- 8039673: Add `reactivateProject(ctx, orgId, slug)` to the `IProjectStore` interface. It
  clears `deleted_at` and reactivates the owner's `project_members` row, returning
  the live project (or `null` if no tombstone with that slug exists). Use it when
  `createProject` fails with a duplicate-key error on a soft-deleted slug, since
  the uniqueness guard blocks recreation even though `getProjectBySlug` returns
  `null` for tombstones. Pairs with the supabase-provider partial-unique-index fix.

## 0.12.3

### Patch Changes

- Updated dependencies [7c10ccf]
  - @selvajs/schemas@4.5.0

## 0.12.2

### Patch Changes

- Updated dependencies [af63f6e]
  - @selvajs/schemas@4.4.0

## 0.12.1

### Patch Changes

- Updated dependencies [58edad5]
  - @selvajs/schemas@4.3.0

## 0.12.0

### Minor Changes

- 9ded581: Cache each definition version's compute-extracted UI schema on the version row, and make schema extraction a hard upload gate.

  `DefinitionVersion` gains optional `schema` + `schemaExtractedAt`, and `IDefinitionStore` gains `setVersionSchema`. On upload, the schema is now extracted and validated against Rhino.Compute **before** any blob or version row is written — a compute outage or a definition with no valid `Schema` output rejects the upload (503 / 422) with nothing persisted. The render path reads the cached schema instead of re-fetching it from compute on every load, falling back to a live fetch (plus a temporary solve-time backfill) for versions uploaded before this change.

  `@selvajs/platform` now re-exports the `UISchema` type from `@selvajs/schemas` (types-only dependency). The Supabase provider adds a `0002` migration creating `definition_versions.schema` / `schema_extracted_at` (and the previously-missing `change_note`) columns.

- 9ded581: Unify the `InputSource` address into a single `key` (schema format v2.9.0 → v2.10.0).

  `InputSource` is now `{ kind: 'user' | 'client' | 'server', key?: string }`. The previously-separate `path` (server) field, the short-lived `producer` (client) field, and the server-only `onMissing` field are removed in favour of one opaque `key`, interpreted by the host per `kind`:
  - `client` → `key` names **which** producer app fills the input (e.g. `'line-app'`, `'file-upload'`) so the host can pre-route to it.
  - `server` → `key` names **what** to fetch (e.g. `'capture.geometry'`) for the host's `IBindingResolver`.

  `kind` already encodes the push (client/browser) vs pull (server) distinction, so a single `key` next to it is the normalised shape — the host decides how to read it; Selva stays domain-agnostic.

  `IBindingResolver.resolve` renames its `paths` parameter to `keys` to match. The C# `SchemaMigrator` (`UnifyInputSourceKey`, run pre-deserialization) folds any saved `path`/`producer` into `key` and drops `onMissing`, so existing schemas load unchanged. Regenerated the TypeScript and C# (`UISchema.Generated.cs`) types; `SchemaVersion` and the migrator registry track the bump (`MigrateTo_2_10_0`).

### Patch Changes

- Updated dependencies [9ded581]
  - @selvajs/schemas@4.0.0

## 0.11.0

### Minor Changes

- 3e5ebe3: Add a server-side binding resolver for schema inputs marked `source.kind === 'bound'`.

  New `IBindingResolver` interface and `NoopBindingResolver` default, exposed via the new optional `SelvaConfig.bindingResolver`. The resolver batches opaque, host-defined paths to values at solve time; the default returns nothing so any bound input fails loudly (matching the schema's `onMissing: 'fail'` default) until a host wires a real implementation.

- Publish the platform interface package and its local + Supabase provider
  implementations to npm. These were previously workspace-private; they are now
  public so external apps can build on the Selva engine (provider interfaces +
  reference implementations) without vendoring the source.

## 0.2.0

### Minor Changes

- # 0.10.0

  A broad release covering platform foundations, a new drawing/PDF pipeline, unified drag-and-drop, schema-source-of-truth work, and a new forward-auth provider. Web apps and `@selvajs/ui` are aligned at 0.10.0; library packages move to the next minor in their respective tracks. The Grasshopper plugin ships as 0.10.0 (beta tag dropped).

  ## Apps & UI (`@selvajs/plugin-ui`, `@selvajs/selva`, `@selvajs/ui`)

  ### Plugin-UI
  - Unified drag-and-drop on `svelte-dnd-action` with a thin cross-type coordinator (replaces three coexisting systems).
  - Schema source-of-truth refactor: canonical/draft split, content-hash for safe save, removal of version/edit-intent state, eliminates drift between plugin `_embeddedSchema`, UI state, and localStorage.
  - New components: `ImageUploadField`, `DataTable`, mode toggle, resizable, scroll-area, search, select, separator, slider, sonner, switch, tabs, textarea, theme switcher.
  - `NumberWidgetConfig` gains `hideRange` for UI control.
  - External input handling with a UI toggle for input sources.
  - Resizable-handle styling, grid-item visibility + column positioning, dropzone active-state highlights.
  - Compute throttle + solving indicator; util reorganisation.

  ### Selva
  - Project-owner definition uploads with access-control tests.
  - Project visibility handling tightened in access-control logic.
  - StatCard refactor across project/team pages and updated project navigation.
  - Audit-log functionality with query support and UI integration.
  - API endpoints for managing platform projects and grants; reclaim functionality.
  - Email-link authentication.
  - Compute-server management refactored to support platform and org-private servers; permissions docs clarified for role scopes.

  ### Cross-cutting UI
  - WebSocket connection handling and schema-history management hardened.
  - Schema history + validation improvements.
  - `NotificationManager` interface + implementation for message handling.
  - Primitive imports and layout-structure refactor; component conventions normalised (see plugin-ui `lib/README`).

  ## Drawing system (`Selva.Drawing` + UI)
  - New SVG drawing components, dimensioning, curve creation, and export.
  - `GH_Page`, `GH_PathStyle` improvements; `RhinoViewportVisitor` rendering enhancements.
  - `DrawingView` / `GH_DrawingView` support multiple geometry elements with auto-fit.
  - New table/grid header-style + fill options.
  - Document layout + pagination logic refactor; `GridOverflow` class + `ComputeOverflows` method for multi-page output.
  - New icons and a page-flow plan for multi-page output.

  ## Schemas (`@selvajs/schemas`)
  - Modular Zod-based validation system for `UISchema`.
  - Custom `IGH_Goo` types for `ValueList`, `ThreeMaterial`, `FileData`, `UISchema` with serialization.
  - `SchemaArchiveSerializer` for schema + values archive serialization.

  ## Platform & providers
  - `@selvajs/header-auth-provider` (new): forward-auth via trusted upstream proxy. Identity verification from proxy headers, allowlist management for user entries.
  - `@selvajs/platform`: project-grant store + interfaces; reclaim flow; clearer role scopes.
  - `@selvajs/local-provider`: env-var handling refactor.

  ## Plugin (.NET / Grasshopper)
  - WebSocket message handling and validation overhauled.
  - Document synchronization and schema handling refactor.
  - Robust volatile + persistent parameter-value extraction.
  - Multi-target: net48 + net7.0 (Rhino 8), net9.0 (Rhino 9-wip) with separate `manifest-rh8.yml` / `manifest-rh9.yml`. Rhino 7 is not supported.
  - Grasshopper group import + enhanced grouping options.
  - `BinaryGeometryWriter` for optimized mesh delivery.
  - `ValueApplicator` + `ValueCollector` services replace ad-hoc plumbing in UIBuilder.
  - Install-directory resolution improvements in the update script.

  ## Tooling, infra, docs
  - Turborepo integration: `pnpm build` / `check` / `type-check` / `test` / `generate` orchestrated via turbo with caching (see `docs/Turborepo.md`).
  - New data-directory layout + setup script changes.
  - PM2 deployment: `--env-file` flag via `node_args` (replaces silently-ignored `env_file` on `pm2 start`).
  - `@selvajs/schemas` workspace dependencies normalised to `workspace:*`.
  - Grasshopper example definitions unignored.
  - Added CONTRIBUTING + changelog; TypeScript schema generation pipeline.
