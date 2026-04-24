-- Definitions + definition_history + atomic run count RPC.
--
-- Design notes:
--  * `definitions.guid` is the PK (matches `DefinitionRecord.guid` in the platform
--    contract — UUID v4 is the "obvious" id the app already uses everywhere).
--  * History (public.definition_history) is its own table with a composite PK
--    `(definition_guid, ref)` so single entries can be inserted/deleted without
--    rewriting the whole row. `HistoryEntry.ref` is a text suffix.
--  * `run_count` is `bigint` — most definitions will stay under 2^31 but
--    bigint is the safe default for counters.
--  * `increment_run_count(g uuid)` RPC runs an atomic `UPDATE … SET run_count = run_count + 1`
--    and returns void. Cloud-over-local improvement — the local provider does
--    a read-modify-write loop which races under load.
--  * Image/cover URL storage is just `cover_image text` — provider ensures it's
--    safe to send to clients (public bucket URL or authenticated proxy path).
--
-- Audit + soft-delete:
--  * `created_by` / `updated_by` replace the old `last_edited_by` field;
--    the TS mapper still reads `last_edited_by` as a fallback for older
--    deployments that haven't been reset, but new installs don't ship it.
--  * `deleted_at` soft-deletes. Reads filter it out. Hard deletion is a
--    service-role retention sweep.
--
-- Versioning scaffold:
--  * `definition_versions` stores immutable snapshots of each uploaded .gh
--    with a monotonic `version_number` per definition.
--  * `definitions.live_version_id` / `draft_version_id` point to the
--    currently-published and in-review versions. Both nullable until the
--    upload/publish flow ships; the columns exist today so the data model
--    stays forward-compatible.

-- ── Table: definitions ────────────────────────────────────────────────────

create table if not exists public.definitions (
	guid uuid primary key,
	project_id uuid not null references public.projects(id) on delete cascade,
	owner_id uuid not null references auth.users(id) on delete cascade,
	created_by uuid references auth.users(id) on delete set null,
	updated_by uuid references auth.users(id) on delete set null,
	-- FKs to definition_versions added after that table is created (below).
	live_version_id uuid,
	draft_version_id uuid,
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
	updated_at timestamptz not null default now(),
	deleted_at timestamptz
);

create index if not exists idx_definitions_project
	on public.definitions(project_id) where deleted_at is null;
create index if not exists idx_definitions_status
	on public.definitions(status) where deleted_at is null;
create index if not exists idx_definitions_pending_updated
	on public.definitions(updated_at)
	where status = 'pending' and deleted_at is null;

drop trigger if exists trg_definitions_updated_at on public.definitions;
create trigger trg_definitions_updated_at before update on public.definitions
	for each row execute function public.set_updated_at();

-- ── Table: definition_versions (B4 scaffold) ──────────────────────────────

create table if not exists public.definition_versions (
	id uuid primary key,
	definition_guid uuid not null references public.definitions(guid) on delete cascade,
	version_number integer not null check (version_number >= 1),
	file_key text not null,
	uploaded_by uuid not null references auth.users(id) on delete cascade,
	uploaded_at timestamptz not null default now(),
	unique (definition_guid, version_number)
);

create index if not exists idx_definition_versions_def
	on public.definition_versions(definition_guid, version_number desc);

-- Wire the live/draft FKs now that the target table exists.
alter table public.definitions
	drop constraint if exists fk_definitions_live_version;
alter table public.definitions
	add constraint fk_definitions_live_version
	foreign key (live_version_id) references public.definition_versions(id)
	on delete set null;

alter table public.definitions
	drop constraint if exists fk_definitions_draft_version;
alter table public.definitions
	add constraint fk_definitions_draft_version
	foreign key (draft_version_id) references public.definition_versions(id)
	on delete set null;

-- ── Table: definition_history (legacy file archive) ───────────────────────
--
-- Retained during the transition from the flat history model to the
-- versioned model. Upload flow still writes HistoryEntry rows; PR-A wiring
-- will replace consumers with definition_versions. Keep both in sync until
-- that lands — removing this table is its own migration, not part of B3/B4.

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
-- Called after each successful solve. No-op if the row doesn't exist or is
-- soft-deleted (matches the platform contract).

create or replace function public.increment_run_count(g uuid)
returns void
language sql
security definer
set search_path = public
as $$
	update public.definitions
	set run_count = run_count + 1
	where guid = g and deleted_at is null;
$$;

grant execute on function public.increment_run_count(uuid) to authenticated, service_role;

-- ── RLS: definitions ─────────────────────────────────────────────────────
--
-- A3 rewrite: project role is authoritative. Commons mode
-- (projects.auto_join_on_upload=true) lets the definition owner edit their
-- own definition; in container mode only project editors/owners may edit.
-- The old `manage_definitions` org-permission side-channel is gone.

alter table public.definitions enable row level security;

drop policy if exists "definitions: visible via project" on public.definitions;
create policy "definitions: visible via project"
on public.definitions for select
to authenticated
using (deleted_at is null and public.visible_project(project_id));

drop policy if exists "definitions: editors can insert" on public.definitions;
create policy "definitions: editors can insert"
on public.definitions for insert
to authenticated
with check (
	public.is_instance_admin()
	-- Container mode: project editor/owner required.
	or exists (
		select 1 from public.project_members m
		where m.project_id = definitions.project_id
		and m.user_id = auth.uid()
		and m.deleted_at is null
		and m.role in ('owner', 'editor')
	)
	-- Commons mode: any authenticated user may create a new definition in a
	-- public + auto_join_on_upload project. They become its owner_id.
	or exists (
		select 1 from public.projects p
		where p.id = definitions.project_id
		and p.deleted_at is null
		and p.visibility = 'public'
		and p.auto_join_on_upload = true
		and definitions.owner_id = auth.uid()
	)
);

drop policy if exists "definitions: editors can update" on public.definitions;
create policy "definitions: editors can update"
on public.definitions for update
to authenticated
using (
	deleted_at is null and (
		public.is_instance_admin()
		-- Project editor/owner moderates any definition in the project.
		or exists (
			select 1 from public.project_members m
			where m.project_id = definitions.project_id
			and m.user_id = auth.uid()
			and m.deleted_at is null
			and m.role in ('owner', 'editor')
		)
		-- Commons carve-out: definition owner can edit their own on commons.
		or exists (
			select 1 from public.projects p
			where p.id = definitions.project_id
			and p.deleted_at is null
			and p.auto_join_on_upload = true
			and definitions.owner_id = auth.uid()
		)
	)
)
with check (
	public.is_instance_admin()
	or exists (
		select 1 from public.project_members m
		where m.project_id = definitions.project_id
		and m.user_id = auth.uid()
		and m.deleted_at is null
		and m.role in ('owner', 'editor')
	)
	or exists (
		select 1 from public.projects p
		where p.id = definitions.project_id
		and p.deleted_at is null
		and p.auto_join_on_upload = true
		and definitions.owner_id = auth.uid()
	)
);

-- DELETE is retained for service-role retention sweeps. Application code
-- soft-deletes (sets deleted_at). The policy shape matches update so an
-- editor can hard-delete if needed during manual cleanup.
drop policy if exists "definitions: editors can delete" on public.definitions;
create policy "definitions: editors can delete"
on public.definitions for delete
to authenticated
using (
	public.is_instance_admin()
	or exists (
		select 1 from public.project_members m
		where m.project_id = definitions.project_id
		and m.user_id = auth.uid()
		and m.deleted_at is null
		and m.role in ('owner', 'editor')
	)
	or exists (
		select 1 from public.projects p
		where p.id = definitions.project_id
		and p.deleted_at is null
		and p.auto_join_on_upload = true
		and definitions.owner_id = auth.uid()
	)
);

-- ── RLS: definition_versions ─────────────────────────────────────────────
--
-- Visibility inherits from the parent definition (which inherits from the
-- parent project). Versions are immutable — no UPDATE policy. No user-level
-- DELETE; retention sweeps use service-role.

alter table public.definition_versions enable row level security;

drop policy if exists "definition_versions: visible via parent" on public.definition_versions;
create policy "definition_versions: visible via parent"
on public.definition_versions for select
to authenticated
using (
	exists (
		select 1 from public.definitions d
		where d.guid = definition_versions.definition_guid
		and d.deleted_at is null
		and public.visible_project(d.project_id)
	)
);

drop policy if exists "definition_versions: editors can insert" on public.definition_versions;
create policy "definition_versions: editors can insert"
on public.definition_versions for insert
to authenticated
with check (
	public.is_instance_admin()
	or exists (
		select 1
		from public.definitions d
		join public.project_members m on m.project_id = d.project_id
		where d.guid = definition_guid
		and d.deleted_at is null
		and m.user_id = auth.uid()
		and m.deleted_at is null
		and m.role in ('owner', 'editor')
	)
	or exists (
		select 1
		from public.definitions d
		join public.projects p on p.id = d.project_id
		where d.guid = definition_guid
		and d.deleted_at is null
		and p.deleted_at is null
		and p.auto_join_on_upload = true
		and d.owner_id = auth.uid()
		and definition_versions.uploaded_by = auth.uid()
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
		and d.deleted_at is null
		and public.visible_project(d.project_id)
	)
);

drop policy if exists "definition_history: editors can insert" on public.definition_history;
create policy "definition_history: editors can insert"
on public.definition_history for insert
to authenticated
with check (
	public.is_instance_admin()
	or exists (
		select 1 from public.definitions d
		join public.project_members m on m.project_id = d.project_id
		where d.guid = definition_guid
		and d.deleted_at is null
		and m.user_id = auth.uid()
		and m.deleted_at is null
		and m.role in ('owner', 'editor')
	)
	or exists (
		select 1 from public.definitions d
		join public.projects p on p.id = d.project_id
		where d.guid = definition_guid
		and d.deleted_at is null
		and p.deleted_at is null
		and p.auto_join_on_upload = true
		and d.owner_id = auth.uid()
	)
);

drop policy if exists "definition_history: editors can delete" on public.definition_history;
create policy "definition_history: editors can delete"
on public.definition_history for delete
to authenticated
using (
	public.is_instance_admin()
	or exists (
		select 1 from public.definitions d
		join public.project_members m on m.project_id = d.project_id
		where d.guid = definition_guid
		and d.deleted_at is null
		and m.user_id = auth.uid()
		and m.deleted_at is null
		and m.role in ('owner', 'editor')
	)
);
