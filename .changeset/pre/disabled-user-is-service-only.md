---
'@selvajs/supabase-provider': patch
---

A disabled user can no longer re-enable themselves. `disableUser` bans the user in GoTrue and sets `app_metadata.disabled`, which only the service role writes; every check that read `user_metadata.disabled` (which the user may rewrite through `PUT /auth/v1/user`) reads those two instead. Migration `20261108140000_selva_disabled_is_service_only` points `user_profiles.disabled` at them, moves users disabled the old way over, and installs `selva.refuse_disabled_caller` as PostgREST's `db_pre_request`, so an access token issued before the disable reads and writes nothing until it expires. A host with its own pre-request hook must call `selva.refuse_disabled_caller()` from it.
