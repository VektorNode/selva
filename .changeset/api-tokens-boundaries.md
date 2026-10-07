---
'@selvajs/platform': minor
'@selvajs/server': minor
'@selvajs/supabase-provider': minor
'@selvajs/selva': patch
---

API tokens stay inside their org and their owner's membership.

- **A token only reaches its own org.** A key's owner may belong to other orgs; the key no longer lists, reads, solves or edits anything there. Other orgs' projects and definitions answer 404. `@selvajs/platform` exports `outsideTokenOrg(ctx, orgId)` for host routes.
- **No instance-admin rights under a key on Supabase.** Delegated sessions carry a `selva_org` claim, and `selva.is_instance_admin()` returns false for them, so an admin's key no longer passes the policies' admin bypass into other orgs. `selva.delegated_org()` exposes the claim to host policies. `IDelegatedSession.mint` now takes `{ orgId }`. **Run `npx selva-supabase` and `npx supabase db push` before updating the app.**
- **Keys follow membership.** Removing a member revokes their keys in that org and disabling a user revokes all of theirs, so re-adding them doesn't revive old keys. `revokeUserApiTokens` is exported from `@selvajs/server/handlers` for host routes.
- **Moving a definition needs edit rights on the destination.** `PATCH /definitions/{guid}` with a new `projectId` used to check only the source project.
- The new-key email links to `SelvaDeps.apiTokenSettingsPath` (default `/settings/tokens`) instead of a hardcoded `/admin/tokens`.
