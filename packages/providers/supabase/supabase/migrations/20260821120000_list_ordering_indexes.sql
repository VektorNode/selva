-- Two index gaps that only show up once the tables grow.
--
-- 1. Definition lists default to `order by created_at` under a `project_id`
--    filter. `idx_definitions_project` covers the filter but not the sort, so
--    every project page sorts its whole slice in memory.
-- 2. Audit pagination is keyset on `(occurred_at desc, id desc)` — see
--    SupabaseAuditQuery — but the existing indexes stop at `occurred_at`, so
--    the tie-breaker is a sort, not an index scan.

create index if not exists idx_definitions_project_created
	on selva.definitions (project_id, created_at desc)
	where deleted_at is null;

drop index if exists selva.audit_events_occurred_at_idx;
create index if not exists audit_events_occurred_at_id_idx
	on selva.audit_events (occurred_at desc, id desc);

drop index if exists selva.audit_events_type_occurred_at_idx;
create index if not exists audit_events_type_occurred_at_id_idx
	on selva.audit_events (type, occurred_at desc, id desc);

drop index if exists selva.audit_events_actor_occurred_at_idx;
create index if not exists audit_events_actor_occurred_at_id_idx
	on selva.audit_events (actor_id, occurred_at desc, id desc);
