---
'@selvajs/supabase-provider': patch
---

Soft-deleted projects no longer occupy their slug/name permanently. The schema's
`(org_id, slug)` and `(org_id, lower(name))` uniqueness guards were unconditional,
so a tombstoned project — invisible to every store read (which filter
`deleted_at is null`) — still blocked recreating a project on the same slug/name
(`createProject` hit 23505). Both guards are now partial unique indexes
`where deleted_at is null`, matching the rest of the schema, so create-after-delete
just works.
