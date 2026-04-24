-- ============================================================================
-- Historical migration, now effectively a no-op.
--
-- Originally this file fixed a column-scoping bug in 0004's RLS policies
-- (`m.project_id = project_id` resolving to `m.project_id = m.project_id`).
-- The access-control refactor rewrote 0004 end-to-end with the fix already
-- in place, plus B1/B3/B4 changes (permission renames, audit fields,
-- soft-delete, versioning scaffold).
--
-- We re-run the drop+create here against the post-refactor policy names so
-- that instances built up through 0004 → 0007 end with the same final state
-- as instances that applied 0007 before the refactor. The predicates below
-- intentionally mirror what 0004 already produced; they don't alter it.
-- ============================================================================

-- Policies here already reflect the post-refactor form written in 0004.
-- Re-running them is idempotent. Keeping the statements so a plain SQL
-- replay works without warnings about unknown policy names.

drop policy if exists "definitions: editors can insert" on public.definitions;
create policy "definitions: editors can insert"
on public.definitions for insert
to authenticated
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
