-- ============================================================================
-- 0002 — Drop `deleted_at IS NULL` (and `revoked_at IS NULL`) from RLS USING
-- clauses on soft-delete tables.
--
-- Why
-- ---
-- The original policies gated row visibility on the row's lifecycle state
-- (e.g. `using (deleted_at is null and ...)`). That looks defensive, but it
-- breaks the soft-delete write itself:
--
--   1. App calls `UPDATE orgs SET deleted_at = now() WHERE id = ? RETURNING id`.
--   2. The UPDATE policy's USING + WITH CHECK both pass (caller is owner /
--      instance_admin).
--   3. PostgREST then re-reads the just-updated row to satisfy `RETURNING`,
--      which runs the SELECT policy over the new row.
--   4. The SELECT policy sees `deleted_at IS NOT NULL` → filters the row out.
--   5. PostgREST surfaces the empty result as
--      `new row violates row-level security policy for table "orgs"`.
--
-- The same trap fires for any UPDATE that sets a "tombstone" column the
-- SELECT policy filters on (`deleted_at`, `revoked_at`).
--
-- Fix
-- ---
-- RLS policies should answer "may this principal touch this row?", not "is
-- this row in a state worth showing?". Soft-delete filtering belongs at the
-- query layer — every store already issues `.is('deleted_at', null)` /
-- `.is('revoked_at', null)` on user-facing reads, so dropping the lifecycle
-- gate from the USING clauses doesn't change what users see.
--
-- This migration drops + recreates the affected SELECT and UPDATE policies
-- without the lifecycle check. Same authority gates, same WITH CHECK
-- clauses — just no longer self-sabotaging on the soft-delete write.
-- ============================================================================

-- orgs ------------------------------------------------------------------------
drop policy if exists "orgs: members and instance admins can read" on public.orgs;
create policy "orgs: members and instance admins can read"
on public.orgs for select
to authenticated
using (public.is_instance_admin() or public.is_org_member(id));

drop policy if exists "orgs: owners and instance admins can update" on public.orgs;
create policy "orgs: owners and instance admins can update"
on public.orgs for update
to authenticated
using (public.is_instance_admin() or public.is_org_owner(id))
with check (public.is_instance_admin() or public.is_org_owner(id));

-- org_members -----------------------------------------------------------------
drop policy if exists "org_members: org members can read roster" on public.org_members;
create policy "org_members: org members can read roster"
on public.org_members for select
to authenticated
using (public.is_instance_admin() or public.is_org_member(org_id));

drop policy if exists "org_members: admins can update" on public.org_members;
create policy "org_members: admins can update"
on public.org_members for update
to authenticated
using (public.is_instance_admin() or public.is_org_admin(org_id))
with check (public.is_instance_admin() or public.is_org_admin(org_id));

-- projects --------------------------------------------------------------------
drop policy if exists "projects: visible to members" on public.projects;
create policy "projects: visible to members"
on public.projects for select
to authenticated
using (public.visible_project(id));

drop policy if exists "projects: owners can update" on public.projects;
create policy "projects: owners can update"
on public.projects for update
to authenticated
using (public.is_instance_admin() or owner_id = auth.uid())
with check (public.is_instance_admin() or owner_id = auth.uid());

-- project_members -------------------------------------------------------------
drop policy if exists "project_members: visible to project members" on public.project_members;
create policy "project_members: visible to project members"
on public.project_members for select
to authenticated
using (public.is_instance_admin() or public.visible_project(project_id));

drop policy if exists "project_members: managers can update" on public.project_members;
create policy "project_members: managers can update"
on public.project_members for update
to authenticated
using (
	public.is_instance_admin()
	or exists (
		select 1 from public.projects p
		where p.id = project_id and p.deleted_at is null and p.owner_id = auth.uid()
	)
)
with check (
	public.is_instance_admin()
	or exists (
		select 1 from public.projects p
		where p.id = project_id and p.deleted_at is null and p.owner_id = auth.uid()
	)
);

-- definitions -----------------------------------------------------------------
drop policy if exists "definitions: visible via project" on public.definitions;
create policy "definitions: visible via project"
on public.definitions for select
to authenticated
using (public.visible_project(project_id));

drop policy if exists "definitions: editors can update" on public.definitions;
create policy "definitions: editors can update"
on public.definitions for update
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

-- definition_versions ---------------------------------------------------------
-- The original schema shipped SELECT + INSERT policies but no DELETE policy.
-- Under RLS that means every `delete from definition_versions` silently
-- affects 0 rows — `SupabaseDefinitionStore.deleteVersion` returns success
-- without removing anything, and FK ON DELETE RESTRICT on
-- `definitions.live_version_id` / `draft_version_id` never gets a chance to
-- raise the 23503 we map to a 409. Same authority as INSERT.
create policy "definition_versions: editors can delete"
on public.definition_versions for delete
to authenticated
using (
	public.is_instance_admin()
	or exists (
		select 1
		from public.definitions d
		join public.project_members m on m.project_id = d.project_id
		where d.guid = definition_versions.definition_guid
		and d.deleted_at is null
		and m.user_id = auth.uid()
		and m.deleted_at is null
		and m.role in ('owner', 'editor')
	)
	or exists (
		select 1
		from public.definitions d
		join public.projects p on p.id = d.project_id
		where d.guid = definition_versions.definition_guid
		and d.deleted_at is null
		and p.deleted_at is null
		and p.auto_join_on_upload = true
		and d.owner_id = auth.uid()
	)
);

-- share_links -----------------------------------------------------------------
-- Same pattern, different tombstone column (`revoked_at`). Revoking a link
-- does `UPDATE ... SET revoked_at = now() RETURNING id`; the old SELECT
-- policy filtered out the just-revoked row and the call failed.
drop policy if exists "share_links: editors can read" on public.share_links;
create policy "share_links: editors can read"
on public.share_links for select
to authenticated
using (
	public.is_instance_admin()
	or exists (
		select 1
		from public.definitions d
		join public.project_members m on m.project_id = d.project_id
		where d.guid = share_links.definition_guid
		and d.deleted_at is null
		and m.user_id = auth.uid()
		and m.deleted_at is null
		and m.role in ('owner', 'editor')
	)
	or exists (
		select 1
		from public.definitions d
		join public.projects p on p.id = d.project_id
		where d.guid = share_links.definition_guid
		and d.deleted_at is null
		and p.deleted_at is null
		and p.auto_join_on_upload = true
		and d.owner_id = auth.uid()
	)
);
