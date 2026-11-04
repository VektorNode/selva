---
'@selvajs/supabase-provider': patch
---

Close `selva` functions that anonymous and signed-in callers could reach through PostgREST with the anon key. That let anyone change platform permissions, claim instance admin, rewrite audit rows and spend share-link quota. These functions now answer only to the service role: `set_platform_permissions`, `claim_first_instance_admin`, `redact_audit_event_email`, `migration_head`, `try_increment_share_link_solve_count` and the trigger functions. `increment_run_count` and `reserve_next_version_number` no longer accept anon.

Apply this release's migration: run `npx selva-supabase`, then `npx supabase db push`. Host apps calling any of these from a browser session have to move the call behind the service role. The migration doesn't undo earlier abuse, so check `selva.user_profiles.platform_permissions` on live deployments.
