-- ============================================================================
-- instance_admin reads what it administers, not tenant content
--
-- The access rules give `instance_admin` a bypass on management (orgs, users,
-- members, compute, project governance) and none on content: `canView`,
-- `canSolve` and `canEdit` apply to staff like anyone else, and Reclaim is the
-- audited way in. RLS gave the bypass to both, so a staff session could read
-- every tenant's private projects, definitions and schemas through PostgREST
-- with no audit event.
--
-- `orgs`, `org_members`, `project_members`, `invites` and `api_tokens` keep
-- their admin branch: those are what an instance admin manages. The app reads a
-- project row as system once a management gate has passed.
-- ============================================================================

-- `projects`, `definitions` and `definition_versions` all select through this.
create or replace function selva.visible_project(p uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
	select exists (
		select 1
		from selva.projects
		where id = p
		and deleted_at is null
		and (
			visibility = 'public'
			or (visibility = 'org' and selva.is_org_member(org_id))
			or selva.is_project_member(id)
		)
	);
$$;

-- Staff still read share-link rows through "org leadership can read the roster":
-- the roster is the control for links whose minter has left.
drop policy if exists "share_links: editors can read" on selva.share_links;
create policy "share_links: editors can read"
on selva.share_links for select
to authenticated
using (
	selva.is_definition_editor(definition_guid)
	or selva.is_definition_contributor(definition_guid)
);
