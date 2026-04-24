-- ============================================================================
-- TODO(access-control refactor / B1): permission identifier renames
--
--   • Every `public.is_platform_admin()` call in this file → `public.is_instance_admin()`
--     once migration 0003 is updated.
-- ============================================================================

-- Definitions + definition_history + atomic run count RPC.
--
-- Design notes:
--  * `definitions.guid` is the PK (matches `DefinitionRecord.guid` in the platform
--    contract — UUID v4 is the "obvious" id the app already uses everywhere).
--  * History is its own table with a composite PK `(definition_guid, ref)` so
--    we can insert/delete single entries without rewriting the whole row.
--    The platform `HistoryEntry.ref` is a text suffix; uuids are not required.
--  * `run_count` is `bigint` — most definitions will stay under 2^31 but
--    bigint is the safe default for counters.
--  * `increment_run_count(g uuid)` RPC runs an atomic `UPDATE … SET run_count = run_count + 1`
--    and returns void. This is the first genuine cloud-over-local improvement:
--    the local provider does a read-modify-write loop which races under load.
--  * Image/cover URL storage is just `coverImage text` — provider ensures it's safe
--    to send to clients (either a public bucket URL or an authenticated proxy path).

-- ── Table ─────────────────────────────────────────────────────────────────

create table if not exists public.definitions (
	guid uuid primary key,
	project_id uuid not null references public.projects(id) on delete cascade,
	owner_id uuid not null references auth.users(id) on delete cascade,
	last_edited_by uuid references auth.users(id) on delete set null,
	compute_server_id uuid,
	file_ext text not null check (file_ext in ('gh', 'ghx')),
	original_filename text,
	display_name text not null,
	description text,
	category text,
	tags text[] not null default '{}',
	cover_image text,
	max_history int not null default 10,
	status text not null check (status in ('pending', 'draft', 'review', 'published', 'archived')),
	run_count bigint not null default 0,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

create index if not exists idx_definitions_project on public.definitions(project_id);
create index if not exists idx_definitions_status on public.definitions(status);
create index if not exists idx_definitions_pending_updated
	on public.definitions(updated_at)
	where status = 'pending';

drop trigger if exists trg_definitions_updated_at on public.definitions;
create trigger trg_definitions_updated_at before update on public.definitions
	for each row execute function public.set_updated_at();

-- ── History table ─────────────────────────────────────────────────────────

create table if not exists public.definition_history (
	definition_guid uuid not null references public.definitions(guid) on delete cascade,
	ref text not null,
	original_name text not null,
	archived_at timestamptz not null default now(),
	uploaded_by uuid references auth.users(id) on delete set null,
	note text,
	primary key (definition_guid, ref)
);

create index if not exists idx_definition_history_archived_at
	on public.definition_history(definition_guid, archived_at desc);

-- ── Atomic run count RPC ──────────────────────────────────────────────────
-- Called after each successful solve. No-op if the row doesn't exist
-- (matches the platform contract).

create or replace function public.increment_run_count(g uuid)
returns void
language sql
security definer
set search_path = public
as $$
	update public.definitions set run_count = run_count + 1 where guid = g;
$$;

grant execute on function public.increment_run_count(uuid) to authenticated, service_role;

-- ── RLS: definitions ─────────────────────────────────────────────────────

alter table public.definitions enable row level security;

drop policy if exists "definitions: visible via project" on public.definitions;
create policy "definitions: visible via project"
on public.definitions for select
to authenticated
using (public.visible_project(project_id));

drop policy if exists "definitions: editors can insert" on public.definitions;
create policy "definitions: editors can insert"
on public.definitions for insert
to authenticated
with check (
	public.is_platform_admin()
	or exists (
		select 1 from public.project_members m
		where m.project_id = definitions.project_id
		and m.user_id = auth.uid()
		and m.role in ('owner', 'editor')
	)
	or public.has_org_permission(
		(select org_id from public.projects where id = definitions.project_id),
		'manage_definitions'
	)
);

drop policy if exists "definitions: editors can update" on public.definitions;
create policy "definitions: editors can update"
on public.definitions for update
to authenticated
using (
	public.is_platform_admin()
	or owner_id = auth.uid()
	or exists (
		select 1 from public.project_members m
		where m.project_id = definitions.project_id
		and m.user_id = auth.uid()
		and m.role in ('owner', 'editor')
	)
)
with check (
	public.is_platform_admin()
	or owner_id = auth.uid()
	or exists (
		select 1 from public.project_members m
		where m.project_id = definitions.project_id
		and m.user_id = auth.uid()
		and m.role in ('owner', 'editor')
	)
);

drop policy if exists "definitions: editors can delete" on public.definitions;
create policy "definitions: editors can delete"
on public.definitions for delete
to authenticated
using (
	public.is_platform_admin()
	or owner_id = auth.uid()
	or exists (
		select 1 from public.project_members m
		where m.project_id = definitions.project_id
		and m.user_id = auth.uid()
		and m.role in ('owner', 'editor')
	)
);

-- ── RLS: definition_history ──────────────────────────────────────────────

alter table public.definition_history enable row level security;

drop policy if exists "definition_history: visible with parent" on public.definition_history;
create policy "definition_history: visible with parent"
on public.definition_history for select
to authenticated
using (
	exists (
		select 1 from public.definitions d
		where d.guid = definition_guid
		and public.visible_project(d.project_id)
	)
);

drop policy if exists "definition_history: editors can insert" on public.definition_history;
create policy "definition_history: editors can insert"
on public.definition_history for insert
to authenticated
with check (
	public.is_platform_admin()
	or exists (
		select 1 from public.definitions d
		join public.project_members m on m.project_id = d.project_id
		where d.guid = definition_guid
		and m.user_id = auth.uid()
		and m.role in ('owner', 'editor')
	)
);

drop policy if exists "definition_history: editors can delete" on public.definition_history;
create policy "definition_history: editors can delete"
on public.definition_history for delete
to authenticated
using (
	public.is_platform_admin()
	or exists (
		select 1 from public.definitions d
		join public.project_members m on m.project_id = d.project_id
		where d.guid = definition_guid
		and m.user_id = auth.uid()
		and m.role in ('owner', 'editor')
	)
);
