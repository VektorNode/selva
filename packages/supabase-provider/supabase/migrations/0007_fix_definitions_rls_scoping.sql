-- Fix RLS policy scoping bug on `public.definitions`.
--
-- In 0004_definitions.sql the insert/update/delete policies checked membership
-- via `where m.project_id = project_id`. Inside the subquery `project_id` is
-- resolved to `project_members.project_id` (the closer scope) rather than
-- `definitions.project_id`, so the predicate degenerates to
-- `m.project_id = m.project_id` — always true. Effect: any authenticated user
-- who is an editor/owner of ANY project could insert/update/delete definitions
-- in ANY other project.
--
-- Fix: qualify the outer column as `definitions.project_id`. `definition_history`
-- already used explicit aliasing and is unaffected.

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
