-- ============================================================================
-- Selva — audit_events
--
-- Persistent sink for the domain events defined in `@selva/platform/events`.
-- Every successful mutation in a data store emits one row here via
-- `SupabaseEventSink`. Read-only from the application's point of view —
-- mutations come exclusively from the sink writer.
--
-- Schema is intentionally generic: type + actor + timestamp + JSONB payload
-- (the entire DomainEvent serialized). New event variants don't require a
-- column migration — only the union in events/interface.ts.
--
-- The UI for viewing this remains deferred (Permissions.md §12); the table
-- exists today so audit data is captured from the moment the system goes live.
-- ============================================================================

create table if not exists public.audit_events (
	id uuid primary key default gen_random_uuid(),
	type text not null,
	actor_id text not null,
	occurred_at timestamptz not null default now(),
	data jsonb not null
);

create index if not exists audit_events_occurred_at_idx
	on public.audit_events (occurred_at desc);

create index if not exists audit_events_type_occurred_at_idx
	on public.audit_events (type, occurred_at desc);

create index if not exists audit_events_actor_occurred_at_idx
	on public.audit_events (actor_id, occurred_at desc);

-- RLS: writes always go through service-role (the sink uses the service
-- client). Authenticated users have NO read access today — the audit-log
-- viewer UI will land later with its own instance_admin-only policy.
alter table public.audit_events enable row level security;
