# Supabase provider — findings

Living log of friction points hit while implementing the Supabase provider
against the `@selva/platform` contracts. Each entry is either:

- a genuine cloud-reality gap the abstraction needs to accept
- a contract ambiguity we can sharpen without breaking the local provider
- a pure Supabase quirk the adapter absorbs alone

Short entries are fine. The goal is: after Phase 1, this file tells us whether
the abstraction held up. Fewer than ~10 entries = the split was good. Many
entries = next refactor target.

## Storage

### Supabase CLI v2.95+ renamed anon/service_role → publishable/secret

`npx supabase status` on v2.95+ prints the new key names under
"Authentication Keys":

- `sb_publishable_…` — replaces the legacy **anon key**
- `sb_secret_…` — replaces the legacy **service_role key**

`@supabase/supabase-js` accepts either format transparently (they're bearer
tokens at the PostgREST layer). Our env vars stay called `SUPABASE_ANON_KEY`
and `SUPABASE_SERVICE_ROLE_KEY` because the meaning hasn't changed — the key
format is an implementation detail of how Supabase signs them.

No abstraction impact, but devs pairing docs with the CLI output get confused:
"there's no anon key here." Documented in the package README.

## Data

### PostgREST returns an all-null composite for no-match `RETURNS single_row` functions

A SECURITY DEFINER function declared as `RETURNS public.invites` and called
via `rpc()` with no matching row returns a composite with every field set to
SQL NULL — _not_ a JavaScript null. PostgREST faithfully serializes the
composite; the client sees `{ id: null, token: null, … }` and treats it as
"data found."

**Resolution:** declare such functions as `RETURNS SETOF public.invites`.
Now "no match" is an empty set, PostgREST returns an empty array, and the
adapter can normalize to `null`.

General rule: for "maybe returns a row" RPCs, always use `SETOF` even when
the function uses `LIMIT 1` internally. Saves the caller from distinguishing
"all nulls" from "real nulls."

### `IInviteStore` and `IComputeServerStore` had no conformance suites

The platform package shipped conformance tests for auth, orgs, projects,
definitions, storage, and user profile — but not invites or compute servers.
The local provider implemented both interfaces without a test harness, and
the shape drift between providers wouldn't have been caught.

**Resolution:** added `inviteStoreSuite` + `computeServerStoreSuite` when
implementing them for Supabase, and wired up conformance tests for both
providers. Small gap in the original coverage; harmless once filled.

### Conformance suites used string ids like `'p1'` and `'u1'` directly

The org/project/definition conformance suites in `@selva/platform/testing`
were written for a JSON-file adapter and constructed records with short
non-UUID ids (`'p1'`, `'u1'`, `'p-a'`). Postgres columns declared as
`uuid primary key` reject these with `invalid input syntax for type uuid`.

**Resolution:** rewrote the suites to use `makeUuid()` everywhere. Behavior
is unchanged for the local provider; the Supabase adapter can now store rows
directly. Keeps the contract honest — the `Project` / `OrgMember` / etc.
interfaces all specify UUID v4, so the tests should have been producing them.

### Conformance suites cannot run in parallel against a shared DB

Vitest defaults to running test files in parallel (`fileParallelism: true`).
Each of our suites calls `resetAllData` in `beforeEach`, which DELETEs every
row. With parallel execution, one file's reset races another file's insert —
the reset wins, the insert lands on an empty table, and FK references into
the just-wiped rows fail with `23503`.

Symptom: inserts that clearly succeeded (verified via `select` on the same
client immediately after) then fail FK constraints from within the same test.

**Resolution:** force serial execution via `fileParallelism: false` +
`pool: forks, singleFork: true` in `vitest.config.ts`. ~14s total runtime
for all conformance tests — acceptable because these are integration tests,
not inner-loop.

Not an abstraction problem. Worth noting so the pattern propagates to any
future provider that hits a shared backend.

### Conformance suites create users out of thin air

`project.ownerId = 'user-1'`, `OrgMember.userId = 'u2'`, etc. are invented
by the suite without first seeding an `auth.users` row. Postgres foreign
keys from `projects.owner_id → auth.users(id)` reject these.

**Resolution:** suites that construct user-id values now accept a
`seedUser?: (id: string) => Promise<void>` hook from the adapter's test
setup. Supabase implements it by calling `auth.admin.createUser` with a
dummy email; local provider passes an identity function. Compute-free for
local, meaningful for any adapter that enforces referential integrity.

## Auth

(nothing yet)

## User profile

(nothing yet)
