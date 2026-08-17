---
'@selvajs/platform': minor
'@selvajs/selva': minor
---

Give the org-owner boundary one predicate instead of three hand-written copies.

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
