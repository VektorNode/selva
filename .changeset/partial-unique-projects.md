---
'@selvajs/supabase-provider': patch
---

Fix soft-deleted projects permanently occupying their slug and name. The `(org_id, slug)` and `(org_id, lower(name))` uniqueness guards were unconditional, so a tombstoned project blocked re-creating a project with the same slug/name even though every store read filters `deleted_at is null`. Replaced both with partial unique indexes (`where deleted_at is null`), matching the rest of the schema, so create-after-delete works.
