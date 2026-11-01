---
'@selvajs/supabase-provider': minor
'@selvajs/local-provider': patch
'@selvajs/platform': patch
'@selvajs/server': patch
---

Row-level security now enforces the access rules on its own, so a user holding a session JWT can't get around them by calling PostgREST directly.

- Pending invites can't be edited apart from being accepted, and minting one is held to `canChangeOrgRole` and the instance-admin rule for platform permissions.
- `org_members` writes follow `canChangeOrgRole`: an admin can no longer promote themselves or change an owner.
- A departed member can't reactivate a project owner row or edit, share or revoke on a commons project. An outsider can still finish a first upload to a public commons.
- `user_profiles` reads are limited to yourself and people who share an org with you.
- API-token sessions stay inside their token's org on every membership check.

Removing an org member now ends their access to private projects the acting admin can't see, through the new `remove_org_member` RPC. Reclaim reaches those projects too, and the orphaned-project report includes them.

The share-link roster now lists links on private projects, through the new `org_share_link_roster` RPC. Commons uploaders can revoke their own links, and `revoke` fails with a 403 or 404 instead of reporting success when RLS filtered the write. `revokeUserApiTokens` runs as `system`, so an operator without a grant on the org no longer leaves a disabled user's tokens live.

`removeOrgMember` throws a 404 for someone who isn't a member, on both providers. Conformance suites in `@selvajs/platform` assert this, so a third-party adapter has to do the same.

Apply this release's migration: run `npx selva-supabase`, then `npx supabase db push`. Host apps that wrote to `selva.invites` with a session JWT can now only set `accepted_at` and `accepted_by_user_id`.
