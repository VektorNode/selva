---
'@selvajs/selva': minor
---

Wire org-member removal into `/team/members`, and stop rendering the same email twice.

`DELETE /api/v1/orgs/{orgId}/members/{userId}` had been fully built and tested —
the owner-only gate, the sole-owner 409, the invite revocation that closes the
re-entry path, the `org_member.removed_orphaning_projects` event — but nothing on
the page called it. The only reachable delete control was the one on the invites
list, which revokes an unaccepted invite and not a membership, so an operator's
route to removing someone from an org was the API directly. Instance scope
(`/admin/users`) and project scope (the settings dialog) both already had theirs.

The button mirrors the route's gates rather than inventing new ones: no
self-removal, no removing the sole owner, and no admin removing an owner —
`canChangeOrgRole` again, on the harder-to-reverse half of the pair. Those live in
`removal-gate.ts` beside the page, not inline in the component, so they are
unit-testable; the route stays load-bearing. The confirm copy names what the
server will not block, since removal proceeds and **reports** the projects it
orphans: it says they can be adopted from Team → Reclaim, which is the recovery
path that already existed for exactly this.

Separately, header-auth deployments were showing `x@y.com · x@y.com` on the admin
user list. The provider mirrors `email` and `displayName` from two proxy headers,
and Entra forwards `mail` for both when the display-name claim is unmapped, so the
pair arrives identical. Four surfaces rendered that pair — the admin user row and
its avatar, the platform-project grantee picker, and the project member picker's
list and selected row — each with its own copy of the "show both" test, so the
duplicate appeared in all of them. One `user-display.ts` now owns it, compared
case-insensitively because the allowlist case-folds the UPN it materializes
`email` from but leaves the forwarded display name as the IdP sent it.

One authority fix falls out of the same pass: `/team/settings` decided "are you
the owner" from `Organization.ownerId`, the only place left that read that column
as authority. It records who created the org and can disagree with the roster —
the `seedAcme` fixture makes it disagree on purpose — so a founder demoted to
`admin` still saw the ownership copy and the delete-org danger zone. It reads the
membership row now, like every other org-role gate. Both controls behind it are
still disabled pending their endpoints, which is why this was cosmetic today and
worth fixing before it wasn't.
