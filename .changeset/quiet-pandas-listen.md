---
'@selvajs/solve': patch
'@selvajs/ui': patch
'@selvajs/supabase-provider': patch
---

Three small fixes found in the open-issue backlog.

The solve client serialized the input values a second time on every solve just to print their size. `JSON.stringify(values).length` ran unconditionally while the log line it fed was behind the `debug` flag, so a potentially MB-scale tree was walked and thrown away on every request in production. The measurement moved inside the `debug` block.

Dialogs cap at `max-h-[85dvh]` and scroll internally. The content primitive set no height bound, so a dialog with a long member list or many form fields grew past the viewport instead of scrolling — the top and bottom, including the confirm button, became unreachable.

Two index gaps in the Supabase schema. Definition lists sort on `created_at` under a `project_id` filter with only a `project_id` index behind them, so each project page sorted its slice in memory; a composite `(project_id, created_at desc)` covers both. And `SupabaseAuditQuery` paginates keyset-style on `(occurred_at desc, id desc)` while the three audit indexes stopped at `occurred_at`, leaving the tie-breaker to a sort — each is replaced by one carrying `id`.
