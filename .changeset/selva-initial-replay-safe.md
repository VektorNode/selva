---
'@selvajs/supabase-provider': patch
---

Make `20260425155514_selva_initial.sql` replay-safe.

The migration issued 41 `create policy`, 5 `create trigger` and 2
`add constraint` statements unguarded, so it aborted with SQLSTATE 42710 on any
database that already held those objects. Each is now preceded by its
`drop ... if exists`, matching the pattern the file already used for
`trg_auth_user_created` and the `selva-public` storage policy. No statement was
removed or reordered — the guards are pure additions.

This matters to a consuming app that squashes its own history into a baseline
dumped from a live database: that dump necessarily contains every `selva` object
this migration creates, and on a fresh database the two run in sequence. The
Supabase CLI selects the whole migration batch _before_ executing any of it, so
recording these timestamps as already-applied from inside the baseline cannot
prevent them running — the stamp lands too late. Making the migration idempotent
is what actually resolves it.
