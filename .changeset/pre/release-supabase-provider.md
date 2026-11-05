---
'@selvajs/supabase-provider': minor
---

API tokens, row-level security that holds on its own, and transactional compute saves. Run `npx selva-supabase`, then `npx supabase db push`, before updating the app.

**Action needed**

- Closed `selva` functions anonymous and signed-in callers could reach through PostgREST (`set_platform_permissions`, `claim_first_instance_admin`, `redact_audit_event_email`, `migration_head`, `try_increment_share_link_solve_count`, trigger functions); they answer only to the service role. The migration doesn't undo earlier abuse: check `selva.user_profiles.platform_permissions` on live deployments.
- Sessions can no longer select `compute_servers.api_key`, and can only set `accepted_at` / `accepted_by_user_id` on `selva.invites`. Host apps doing either with a session JWT must move behind the service role.

**Added**

- `SupabaseApiTokenStore` and the `api_tokens` migration; `audit_events.token_id`; `definitions.source_document_id`.
- Delegated sessions: `SupabaseAuthProvider` signs ES256 with `SUPABASE_JWT_SIGNING_KEY` or HS256 with `SUPABASE_JWT_SECRET`, with a configurable lifetime (`delegatedSessionTtlSeconds`). A key's session carries `selva_org`, so `selva.is_instance_admin()` is false under a key.
- `save_platform_compute_servers` / `save_org_compute_servers`, `remove_org_member` and `org_share_link_roster` RPCs. `supabaseUpstream` for request timing. `/config` env slice.

**Fixed**

- RLS enforces the access rules directly: invites, `org_members` role changes, commons projects and `user_profiles` reads follow the same rules as the app.
- Erasing a user nulls `owner_id` / `uploaded_by` instead of deleting shared orgs, projects and versions.
- Compute saves run in one transaction and keep unchanged servers' defaults. Two admins demoting each other no longer deadlock. Saving a definition with no tags no longer fails. Storage listing pages past 1000 entries.
