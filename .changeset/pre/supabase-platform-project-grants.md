---
'@selvajs/supabase-provider': minor
'@selvajs/platform': patch
---

The Supabase provider stores platform-project grants, so `SELVA_FLAG_ENABLE_PLATFORM_PROJECTS` now boots on Supabase. Migration `20261117200000_selva_platform_project_grants` admits `platform` visibility, adds `platform_project_grants` (sessions read under RLS, the service role writes) and opens a platform project under RLS to its grantees only. Deleting a project or org removes its grants, and erasing a user removes grants made to them. Run `npx selva-supabase` and `npx supabase db push` before turning the flag on.
