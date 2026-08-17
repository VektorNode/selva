# @selvajs/supabase-provider

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

### Patch Changes

- Updated dependencies [e779034]
- Updated dependencies [e779034]
- Updated dependencies [e779034]
- Updated dependencies [e779034]
  - @selvajs/platform@0.19.0

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

### Patch Changes

- Updated dependencies [679a24f]
  - @selvajs/platform@0.18.0

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
- 4512068: Fix `createOrg` failing on every org that has no branding assets: `orgToRow` wrote an explicit
  `null` into `selva.orgs.assets`, which is `not null default '{}'::jsonb`.

  `Organization.assets` is optional, so `org.assets ?? null` produced `null` for any org created
  without branding — the overwhelmingly common case. Sending the column explicitly defeats the
  `default '{}'`, which only applies when the column is _omitted_ from the insert, so Postgres rejected
  the row with `null value in column "assets" of relation "orgs" violates not-null constraint`.
  `createOrg` threw before it could seed the owner's `org_members` row, so the failure took org
  creation with it rather than just the asset map.

  `OrgRow.assets` is typed `Record<string, string> | null | undefined`, so the null type-checked
  cleanly — the constraint lives in the migration, not in TypeScript. `orgToRow` now writes `{}`, which
  is both the column default and what `rowToOrg` already round-trips back to `undefined`, so the
  domain-level "no assets" representation is unchanged in both directions.

  Also fixes two stale assertions uncovered while verifying this against a live stack:

  - The storage conformance suite still asserted definition covers land in the **public** bucket.
    Covers were deliberately reclassified as `visibility: 'project'` (auth-gated, served through the
    proxy) when the asset-class registry landed; the route tests were updated then, this one was not.
    Two doc comments in `SupabaseStorageProvider` likewise still claimed covers stay public,
    contradicting the `bucketFor` implementation directly beneath them.
  - `org-conformance` built `SupabaseComputeServerStore` without an at-rest key, so the org-delete
    cascade test could not save a compute server carrying an `apiKey`.

  The suites now skip with a single explanatory warning when the local Supabase stack is unreachable,
  instead of failing every conformance test with an opaque `TypeError: fetch failed`. `.env.test` is
  checked in with local-stack defaults, so its presence alone never meant a stack was actually running
  — which is what kept this bug hidden.

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
  - @selvajs/platform@0.17.0

## 0.17.0-beta.4

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
  - @selvajs/platform@0.17.0-beta.3

## 0.16.1-beta.3

### Patch Changes

- a011c5e: Unify the vitest setup across the workspace behind `@selvajs/config/vitest`.

  Packaging fix: `@selvajs/compute`, `@selvajs/solve`, `@selvajs/visualization`
  and `@selvajs/schemas` had no test-file exclusion in `files`, so a change of
  build tool would have shipped tests to npm. All publishable packages now carry
  the same exclusion.

  `@selvajs/platform`'s test suite was never wired to a runner and had never
  executed; it now runs with the rest.

- Updated dependencies [a011c5e]
  - @selvajs/platform@0.16.1-beta.2

## 0.16.1-beta.2

### Patch Changes

- 0e2c428: Clean up published tarballs. The monorepo-internal `source` export condition is renamed to `selva-source` so it can never collide with a consumer resolving the common `source` condition; published packages no longer ship raw `src/` TypeScript or compiled test files. Publish-time manifest rewriting is gone — the committed package.json is what ships, gated by `publint --strict` and a tarball contents check.
- Updated dependencies [0e2c428]
  - @selvajs/platform@0.16.1-beta.1

## 0.16.1-beta.1

### Patch Changes

- @selvajs/platform@0.16.1-beta.0

## 0.16.1-beta.0

### Patch Changes

- 3b6746e: Fix `createOrg` failing on every org that has no branding assets: `orgToRow` wrote an explicit
  `null` into `selva.orgs.assets`, which is `not null default '{}'::jsonb`.

  `Organization.assets` is optional, so `org.assets ?? null` produced `null` for any org created
  without branding — the overwhelmingly common case. Sending the column explicitly defeats the
  `default '{}'`, which only applies when the column is _omitted_ from the insert, so Postgres rejected
  the row with `null value in column "assets" of relation "orgs" violates not-null constraint`.
  `createOrg` threw before it could seed the owner's `org_members` row, so the failure took org
  creation with it rather than just the asset map.

  `OrgRow.assets` is typed `Record<string, string> | null | undefined`, so the null type-checked
  cleanly — the constraint lives in the migration, not in TypeScript. `orgToRow` now writes `{}`, which
  is both the column default and what `rowToOrg` already round-trips back to `undefined`, so the
  domain-level "no assets" representation is unchanged in both directions.

  Also fixes two stale assertions uncovered while verifying this against a live stack:

  - The storage conformance suite still asserted definition covers land in the **public** bucket.
    Covers were deliberately reclassified as `visibility: 'project'` (auth-gated, served through the
    proxy) when the asset-class registry landed; the route tests were updated then, this one was not.
    Two doc comments in `SupabaseStorageProvider` likewise still claimed covers stay public,
    contradicting the `bucketFor` implementation directly beneath them.
  - `org-conformance` built `SupabaseComputeServerStore` without an at-rest key, so the org-delete
    cascade test could not save a compute server carrying an `apiKey`.

  The suites now skip with a single explanatory warning when the local Supabase stack is unreachable,
  instead of failing every conformance test with an opaque `TypeError: fetch failed`. `.env.test` is
  checked in with local-stack defaults, so its presence alone never meant a stack was actually running
  — which is what kept this bug hidden.

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

### Patch Changes

- Updated dependencies [efb003a]
  - @selvajs/platform@0.16.0

## 0.15.1

### Patch Changes

- 650ef18: Fix two live defects in `SupabaseAuthProvider`: disabled users could refresh
  sessions indefinitely, and `last_login_at` never updated.

  **`refreshSession` did not check `disabled`.** `signIn`, `exchangeOAuthCode`, and
  `verifyMagicLink` all reject users flagged `user_metadata.disabled === true`;
  `refreshSession` did not. This was not a latent gap — the session-refresh
  middleware in `hooks.server.ts` calls it on every request where `verifyToken`
  fails, so a disabled user's expired access token was silently swapped for a
  fresh one on the next request, forever. The `revalidateMs` revocation bound on
  `verifyToken` never applied, because that path had already failed by the time
  refresh ran. Disabling a user now takes effect within one access-token lifetime
  on the refresh path. GoTrue already returns the user alongside the session, so
  the check costs no extra round-trip.

  **`touchLastLogin` wrote to the wrong schema.** Engine tables live in the `selva`
  schema, and every client in `data/client.ts` pins `db: { schema: 'selva' }`. The
  auth provider's service-role client was constructed without that option, so it
  resolved `user_profiles` against `public` — where the table does not exist.
  PostgREST returned a relation-not-found error, and the unchecked `await`
  swallowed it, so `last_login_at` silently never updated in any Supabase
  deployment. Table access now goes through a schema-pinned client, and a failed
  stamp is logged rather than discarded. The write stays best-effort and still
  never throws, per the `IAuthProvider.touchLastLogin` contract.

  `this.admin` is deliberately left unpinned: it drives `auth.admin.*`, which is
  GoTrue's own REST surface and unaffected by the PostgREST schema setting.

  `SupabaseAuthProvider.fromEnv` now accepts an optional second `ILogger`
  argument, matching `HeaderAuthProvider.fromEnv`. Purely additive — omitting it
  keeps the previous `NoopLogger` behavior. `@selvajs/selva` passes its
  `lazyLogger` through, so the failure above is actually visible in the app
  rather than swallowed.

## 0.15.0

### Minor Changes

- 21124cb: Ship the `getServerApiKey` implementations on both compute-server stores
  (`SupabaseComputeServerStore`, `LocalComputeServerStore`).

  The method was added to `IComputeServerStore` and both provider sources in the
  same commit as the structured-logging work, but neither provider carried a
  changeset — so the published `@selvajs/supabase-provider@0.14.4-beta.1` and
  `@selvajs/local-provider@0.12.8-beta.1` tarballs (released three days earlier)
  predate it, while `@selvajs/platform@0.15.0-beta.2` now publishes the interface
  requiring it. Against the published providers, `@selvajs/selva` code paths that
  call `store.getServerApiKey(...)` (compute resolve, admin health/status/actions
  routes) fail with a runtime `TypeError`, and consumers fail to typecheck the
  store against the current platform interface. This release publishes provider
  builds that actually carry the method.

### Patch Changes

- 5077fe9: Adding advanced caching
- 2673995: Extract the definitions server slice into `@selvajs/server/definitions` (embeddable-server-layer K4) and implement the ADR 0005 schema-versioning story:

  - **`@selvajs/server/definitions`** — new subpath exporting `DefinitionService` (write orchestration across data + storage), `fetchSchemaFromCompute` / `SchemaExtractionError` (the upload validate-and-cache gate), `assertSupportedSchemaVersion` (rejects schemas authored with a newer plugin than the app supports), and `createDefinitionLoader` (the render loader, all wiring injected via `DefinitionLoaderDeps`). The loader treats a stored schema as a disposable cache: used only when its `schemaVersion` matches the app's `UI_SCHEMA_VERSION`, otherwise re-extracted from compute (which runs the C# migrator) and persisted back best-effort.
  - Fixed a latent bug in schema extraction: shallow `camelcaseKeys` is a no-op on arrays, so the PascalCase `Schemas` wrapper key from compute was never normalized; each wrapper element is now camelcased individually.
  - **`@selvajs/supabase-provider`** — new migration adding a `schema_version` GENERATED column on `definition_versions` (derived from `schema->>'schemaVersion'`, ops/diagnostics only).
  - **`@selvajs/selva`** — `DefinitionService`, `schemaExtraction.server`, and `loadForRender.server` are now thin bindings over `@selvajs/server/definitions`.

- Updated dependencies [5077fe9]
- Updated dependencies [b8607d4]
- Updated dependencies [243ae19]
- Updated dependencies [a8e1b47]
  - @selvajs/platform@0.15.0

## 0.15.0-beta.3

### Patch Changes

- Adding advanced caching
- Updated dependencies
  - @selvajs/platform@0.15.0-beta.4

## 0.15.0-beta.2

### Minor Changes

- 21124cb: Ship the `getServerApiKey` implementations on both compute-server stores
  (`SupabaseComputeServerStore`, `LocalComputeServerStore`).

  The method was added to `IComputeServerStore` and both provider sources in the
  same commit as the structured-logging work, but neither provider carried a
  changeset — so the published `@selvajs/supabase-provider@0.14.4-beta.1` and
  `@selvajs/local-provider@0.12.8-beta.1` tarballs (released three days earlier)
  predate it, while `@selvajs/platform@0.15.0-beta.2` now publishes the interface
  requiring it. Against the published providers, `@selvajs/selva` code paths that
  call `store.getServerApiKey(...)` (compute resolve, admin health/status/actions
  routes) fail with a runtime `TypeError`, and consumers fail to typecheck the
  store against the current platform interface. This release publishes provider
  builds that actually carry the method.

## 0.14.4-beta.1

### Patch Changes

- Updated dependencies
  - @selvajs/platform@0.15.0-beta.1

## 0.14.4-beta.0

### Patch Changes

- 2673995: Extract the definitions server slice into `@selvajs/server/definitions` (embeddable-server-layer K4) and implement the ADR 0005 schema-versioning story:

  - **`@selvajs/server/definitions`** — new subpath exporting `DefinitionService` (write orchestration across data + storage), `fetchSchemaFromCompute` / `SchemaExtractionError` (the upload validate-and-cache gate), `assertSupportedSchemaVersion` (rejects schemas authored with a newer plugin than the app supports), and `createDefinitionLoader` (the render loader, all wiring injected via `DefinitionLoaderDeps`). The loader treats a stored schema as a disposable cache: used only when its `schemaVersion` matches the app's `UI_SCHEMA_VERSION`, otherwise re-extracted from compute (which runs the C# migrator) and persisted back best-effort.
  - Fixed a latent bug in schema extraction: shallow `camelcaseKeys` is a no-op on arrays, so the PascalCase `Schemas` wrapper key from compute was never normalized; each wrapper element is now camelcased individually.
  - **`@selvajs/supabase-provider`** — new migration adding a `schema_version` GENERATED column on `definition_versions` (derived from `schema->>'schemaVersion'`, ops/diagnostics only).
  - **`@selvajs/selva`** — `DefinitionService`, `schemaExtraction.server`, and `loadForRender.server` are now thin bindings over `@selvajs/server/definitions`.
  - @selvajs/platform@0.14.3-beta.0

## 0.14.3

### Patch Changes

- 2173bef: Fix Supabase local port configuration and wire the solve-metric sink into the server test setup.

## 0.14.2

### Patch Changes

- @selvajs/platform@0.14.2

## 0.14.1

### Patch Changes

- @selvajs/platform@0.14.1

## 0.14.0

### Minor Changes

- fed3a9e: Capture per-solve timing and outcome telemetry.
  - **platform**: new pluggable `ISolveMetricSink` provider (`SelvaConfig.solveMetrics`, defaults to `NoopSolveMetricSink`). A `SolveMetric` records the solve's wall-clock `durationMs`, `ok`, a `failureKind` (`timeout` | `client_abort` | `rate_limited` | `share_cap` | `too_large` | `compute_error` | `ok`), Grasshopper `errorCount`/`warningCount`, and attribution: `definitionId` + `versionId` (so timings compare across definition versions), `orgId`, and `channel`. Adds the `runSolveMetricSinkConformance` testing suite.
  - **supabase-provider**: `SupabaseSolveMetricSink` persists every solve to the new `selva.solve_metrics` table (with the triggering user in `actor_id`). Exposed off `SupabaseDataProvider` so it wires automatically when the Supabase data provider is selected. Includes the migration and a conformance test.
  - **selva**: the compute route now records one metric per solve attempt — including attempts rejected before the solve runs (rate limit, share-link cap) — and distinguishes a genuine solve timeout from a client disconnect. A successful solve of a local definition also bumps that definition's `solveCount` (the "N runs" stat shown on definition cards/lists), which was previously never incremented.

### Patch Changes

- Updated dependencies [fed3a9e]
  - @selvajs/platform@0.14.0

## 0.13.5

### Patch Changes

- 2655d2e: Soft-deleted projects no longer occupy their slug/name permanently. The schema's
  `(org_id, slug)` and `(org_id, lower(name))` uniqueness guards were unconditional,
  so a tombstoned project — invisible to every store read (which filter
  `deleted_at is null`) — still blocked recreating a project on the same slug/name
  (`createProject` hit 23505). Both guards are now partial unique indexes
  `where deleted_at is null`, matching the rest of the schema, so create-after-delete
  just works.
- Updated dependencies [8039673]
  - @selvajs/platform@0.13.0

## 0.13.5-beta.2

### Patch Changes

- 2655d2e: Soft-deleted projects no longer occupy their slug/name permanently. The schema's
  `(org_id, slug)` and `(org_id, lower(name))` uniqueness guards were unconditional,
  so a tombstoned project — invisible to every store read (which filter
  `deleted_at is null`) — still blocked recreating a project on the same slug/name
  (`createProject` hit 23505). Both guards are now partial unique indexes
  `where deleted_at is null`, matching the rest of the schema, so create-after-delete
  just works.

## 0.13.5-beta.1

### Patch Changes

- Roll beta prerelease.

## 0.13.5-beta.0

### Patch Changes

- 9712a7f: Fix soft-deleted projects permanently occupying their slug and name. The `(org_id, slug)` and `(org_id, lower(name))` uniqueness guards were unconditional, so a tombstoned project blocked re-creating a project with the same slug/name even though every store read filters `deleted_at is null`. Replaced both with partial unique indexes (`where deleted_at is null`), matching the rest of the schema, so create-after-delete works.

## 0.13.4

### Patch Changes

- @selvajs/platform@0.12.3

## 0.13.3

### Patch Changes

- @selvajs/platform@0.12.2

## 0.13.2

### Patch Changes

- @selvajs/platform@0.12.1

## 0.13.1

### Patch Changes

- 1f6afe3: Pin `selva.set_updated_at()` to an empty `search_path` via a new migration, resolving the Supabase linter `function_search_path_mutable` warning.

## 0.13.0

### Minor Changes

- e7d2adb: Move all engine tables into a dedicated `selva` Postgres schema instead of `public`.

  A consuming app sharing the same database now keeps `public` entirely for its own tables — `selva.projects` and a consumer's `public.projects` can coexist, removing the name-clash that previously forced consumers to rename around the engine. The data clients are constructed with `db: { schema: 'selva' }`, the initial migration creates the schema, grants the standard roles, and exposes it to PostgREST via `alter role authenticator set pgrst.db_schemas` (done from the migration, not `config.toml`, to avoid the boot-before-migrations race).

  **Breaking for existing databases on the old `public` layout.** This is a table relocation, not an additive change. A fresh install (`db reset` / first `db push`) just works. A database with live data on the old layout needs a data-preserving `alter table … set schema selva` migration path — not covered by the fresh-install SQL. Consumers referencing engine objects from their own migrations must qualify them with `selva.` (`references selva.orgs`, `selva.is_org_member()`, `selva.is_instance_admin()`, `selva.set_updated_at()`).

  Also fixes a pre-existing missing UPDATE RLS policy on `definition_versions` that caused `setVersionSchema` to silently write 0 rows for user-scoped callers.

## 0.12.0

### Minor Changes

- 9ded581: Cache each definition version's compute-extracted UI schema on the version row, and make schema extraction a hard upload gate.

  `DefinitionVersion` gains optional `schema` + `schemaExtractedAt`, and `IDefinitionStore` gains `setVersionSchema`. On upload, the schema is now extracted and validated against Rhino.Compute **before** any blob or version row is written — a compute outage or a definition with no valid `Schema` output rejects the upload (503 / 422) with nothing persisted. The render path reads the cached schema instead of re-fetching it from compute on every load, falling back to a live fetch (plus a temporary solve-time backfill) for versions uploaded before this change.

  `@selvajs/platform` now re-exports the `UISchema` type from `@selvajs/schemas` (types-only dependency). The Supabase provider adds a `0002` migration creating `definition_versions.schema` / `schema_extracted_at` (and the previously-missing `change_note`) columns.

### Patch Changes

- Updated dependencies [9ded581]
- Updated dependencies [9ded581]
  - @selvajs/platform@0.12.0

## 0.11.0

### Minor Changes

- Publish the platform interface package and its local + Supabase provider
  implementations to npm. These were previously workspace-private; they are now
  public so external apps can build on the Selva engine (provider interfaces +
  reference implementations) without vendoring the source.

### Patch Changes

- Updated dependencies [3e5ebe3]
- Updated dependencies
  - @selvajs/platform@0.11.0

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

### Patch Changes

- Updated dependencies
  - @selvajs/platform@0.2.0
