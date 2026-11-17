---
'@selvajs/platform': minor
'@selvajs/local-provider': minor
'@selvajs/supabase-provider': minor
'@selvajs/selva': patch
---

`IOrgStore.countOrgMembers` and `IProjectStore.countProjectMembers` return live member counts for many ids in one call. Custom store implementations must add both. Member counts on `/team`, `/team/projects`, `/team/reclaim` and `/admin/organizations` no longer stop at the roster page limit, and the admin organizations page no longer lists every org's roster to count it.
