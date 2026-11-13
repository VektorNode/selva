---
'@selvajs/supabase-provider': minor
'@selvajs/selva': minor
'@selvajs/platform': patch
'@selvajs/server': patch
---

**Supabase: signed-in sessions can no longer write to `selva` tables.** The anon key is publishable, so a user could call PostgREST with their own session JWT, and the RLS write policies allowed more than the app does: a version row naming another tenant's `.gh` (which Selva then solved or deleted with the service role), a project moved into another org or made public, a user added to an org without an invite, a removed project creator re-seated as owner, org compute servers written past the feature flag and the URL guard, and self-minted API tokens. Migration `20261113120000` revokes INSERT, UPDATE and DELETE from `anon` and `authenticated`, drops the write policies, and revokes EXECUTE on the functions that write. The stores now write with the service role after the app's checks; reads still run as the caller under RLS.

Fixed along the way, because they came from the same split: deleting a project left its definitions live with working share links; revoking an invite an admin could not have issued answered 204 and did nothing; org branding changed the stored image before a refused update; a project slug clash was never retried with a suffix; a deleted org's slug could not be reused.

Migration `20261113130000` takes tenant content away from `instance_admin` at the database: a staff session could read every tenant's private projects, definitions and schemas through PostgREST with no audit event, although the access rules give staff no bypass on content. Management data (orgs, rosters, invites, the share-link roster) stays readable, and the management guards now load a project as system for an instance admin.

New in the schema: a version's `file_key` must be `definitions/{guid}/versions/v{n}.{ext}` (existing rows are not checked), a project cannot change org, and new tables start with no grants.

**Upgrade order: update the app, then `npx supabase db push`.** The new app runs on the old schema and shows the migrations as pending in `/admin/system` until they are pushed. An older app on the new schema has every write refused, so `selva.dataFormat` goes to 3 and the updater will not install an earlier release afterwards. Host apps that write `selva` tables through the stores need no change; one that wrote them with a user-scoped client must use the stores or the service role.
