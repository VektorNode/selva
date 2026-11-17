-- ============================================================================
-- Platform projects
--
-- A `platform` project belongs to no tenant's audience: an instance admin
-- grants it to orgs or single users, view-only or view+solve. Grants are not
-- project membership, so they live in their own table.
--
-- RLS cannot read ENABLE_PLATFORM_PROJECTS, so with the flag off the app hides
-- these projects; RLS still opens one only to its grantees.
-- ============================================================================

alter table selva.projects drop constraint if exists projects_visibility_check;
alter table selva.projects add constraint projects_visibility_check
	check (visibility in ('public', 'org', 'private', 'platform'));

-- `grantee_id` names an org or a user, so it has no FK. The store removes org
-- grants when the org goes, and user grants when the user is erased. No FK on
-- `created_by` either: erasure nulls it, which the store reads as 'deleted'.
create table if not exists selva.platform_project_grants (
	id uuid primary key,
	project_id uuid not null references selva.projects(id) on delete cascade,
	grantee_type text not null check (grantee_type in ('org', 'user')),
	grantee_id uuid not null,
	can_solve boolean not null default false,
	created_by uuid,
	created_at timestamptz not null default now(),
	constraint platform_project_grants_grantee_key unique (project_id, grantee_type, grantee_id)
);

create index if not exists idx_platform_project_grants_grantee
	on selva.platform_project_grants (grantee_type, grantee_id);
create index if not exists idx_platform_project_grants_created_by
	on selva.platform_project_grants (created_by);

alter table selva.platform_project_grants enable row level security;

-- Sessions read, the store writes with the service role.
grant select on selva.platform_project_grants to authenticated;

-- A grantee reads the grants that open a project to them: the app's access
-- check loads them with the caller's session.
drop policy if exists "platform_project_grants: admins and grantees read"
on selva.platform_project_grants;
create policy "platform_project_grants: admins and grantees read"
on selva.platform_project_grants for select
to authenticated
using (
	selva.is_instance_admin()
	or (grantee_type = 'user' and grantee_id = auth.uid())
	or (grantee_type = 'org' and selva.is_org_member(grantee_id))
);

-- A platform project opens through a grant only: a member row (its creator's)
-- does not count, as in `canView`. An org grant opens it to every org the
-- caller belongs to, while the app matches only the acting org: RLS cannot see
-- which org a session acts as. A delegated session stays in its token org, as
-- the app's token guard does.
create or replace function selva.visible_project(p uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
	select exists (
		select 1
		from selva.projects proj
		where proj.id = p
		and proj.deleted_at is null
		and (
			proj.visibility = 'public'
			or (proj.visibility = 'org' and selva.is_org_member(proj.org_id))
			or (proj.visibility <> 'platform' and selva.is_project_member(proj.id))
			or (
				proj.visibility = 'platform'
				and selva.in_token_scope(proj.org_id)
				and exists (
					select 1 from selva.platform_project_grants g
					where g.project_id = proj.id
					and (
						(g.grantee_type = 'user' and g.grantee_id = auth.uid())
						or (g.grantee_type = 'org' and selva.is_org_member(g.grantee_id))
					)
				)
			)
		)
	);
$$;
