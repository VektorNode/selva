---
'@selvajs/supabase-provider': minor
'@selvajs/local-provider': minor
'@selvajs/platform': minor
---

Make the sole-`instance_admin` invariant atomic in both providers.

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
