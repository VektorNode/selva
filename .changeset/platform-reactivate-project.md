---
'@selvajs/platform': minor
---

Add `reactivateProject(ctx, orgId, slug)` to the `IProjectStore` interface. It
clears `deleted_at` and reactivates the owner's `project_members` row, returning
the live project (or `null` if no tombstone with that slug exists). Use it when
`createProject` fails with a duplicate-key error on a soft-deleted slug, since
the uniqueness guard blocks recreation even though `getProjectBySlug` returns
`null` for tombstones. Pairs with the supabase-provider partial-unique-index fix.
