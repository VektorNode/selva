---
'@selvajs/supabase-provider': patch
---

Fix `createOrg` failing on every org that has no branding assets: `orgToRow` wrote an explicit
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
