---
'@selvajs/supabase-provider': minor
'@selvajs/local-provider': minor
'@selvajs/platform': minor
---

Make the first-admin bootstrap atomic, so "first signer wins" is true under concurrency.

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
