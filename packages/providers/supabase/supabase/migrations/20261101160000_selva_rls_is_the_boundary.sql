-- ============================================================================
-- RLS is the boundary, and it matches `rules.ts`
--
-- The anon key is publishable, so anyone holding a session JWT can reach
-- PostgREST without going through Selva. Every rule the app enforces on a write
-- has to hold here on its own.
--
-- `public` still ignores ALLOW_CROSS_ORG_PUBLIC: Postgres cannot read the app's
-- env, so the app stays authoritative for that flag.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Membership helpers stay inside a delegated session's token org
-- ----------------------------------------------------------------------------

-- A token for org A runs under its owner's JWT, so a helper that only looks at
-- `auth.uid()` also answers yes for every other org that user belongs to.
create or replace function selva.in_token_scope(o uuid)
returns boolean
language sql stable
as $$
	select selva.delegated_org() is null or selva.delegated_org() = o;
$$;

create or replace function selva.is_org_member(o uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
	select selva.in_token_scope(o) and exists (
		select 1 from selva.org_members
		where org_id = o and user_id = auth.uid() and deleted_at is null
	);
$$;

create or replace function selva.is_org_admin(o uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
	select selva.in_token_scope(o) and exists (
		select 1 from selva.org_members
		where org_id = o and user_id = auth.uid() and deleted_at is null
		and role in ('owner', 'admin')
	);
$$;

create or replace function selva.is_org_owner(o uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
	select selva.in_token_scope(o) and exists (
		select 1 from selva.org_members
		where org_id = o and user_id = auth.uid() and deleted_at is null
		and role = 'owner'
	);
$$;

create or replace function selva.has_org_permission(o uuid, perm text)
returns boolean
language sql stable security definer set search_path = public
as $$
	select selva.is_instance_admin() or (selva.in_token_scope(o) and exists (
		select 1 from selva.org_members
		where org_id = o and user_id = auth.uid() and deleted_at is null
		and perm = any(permissions)
	));
$$;

create or replace function selva.is_project_member(p uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
	select exists (
		select 1
		from selva.project_members m
		join selva.projects proj on proj.id = m.project_id
		where m.project_id = p and m.user_id = auth.uid() and m.deleted_at is null
		and selva.in_token_scope(proj.org_id)
	);
$$;

create or replace function selva.is_project_owner(p uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
	select exists (
		select 1
		from selva.project_members m
		join selva.projects proj on proj.id = m.project_id
		where m.project_id = p and m.user_id = auth.uid() and m.deleted_at is null
		and m.role = 'owner'
		and selva.in_token_scope(proj.org_id)
	);
$$;

create or replace function selva.is_project_editor(p uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
	select exists (
		select 1
		from selva.project_members m
		join selva.projects proj on proj.id = m.project_id
		where m.project_id = p and m.user_id = auth.uid() and m.deleted_at is null
		and m.role in ('owner', 'editor')
		and selva.in_token_scope(proj.org_id)
	);
$$;

-- A creator who left the org keeps `owner_id`, which must not bring them back.
create or replace function selva.may_seed_project_owner(p uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
	select exists (
		select 1 from selva.projects proj
		where proj.id = p
		and proj.deleted_at is null
		and selva.is_org_member(proj.org_id)
		and (proj.owner_id = auth.uid() or selva.is_org_admin(proj.org_id))
	);
$$;

-- ----------------------------------------------------------------------------
-- 2. Commons authority follows `canEditDefinition`
-- ----------------------------------------------------------------------------

-- `ownerId` is stamped at upload and never revisited, so it only counts for as
-- long as the uploader belongs to the org.
create or replace function selva.is_commons_contributor(p uuid, definition_owner uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
	select definition_owner = auth.uid() and exists (
		select 1 from selva.projects proj
		where proj.id = p
		and proj.deleted_at is null
		and proj.auto_join_on_upload
		and selva.is_org_member(proj.org_id)
	);
$$;

-- An upload is several writes, and an outsider may make them on a public commons
-- without ever being a contributor, so this also carries the insert and the
-- first version.
create or replace function selva.may_upload_to_commons(p uuid, definition_owner uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
	select definition_owner = auth.uid() and selva.visible_project(p) and exists (
		select 1 from selva.projects proj
		where proj.id = p
		and proj.deleted_at is null
		and proj.auto_join_on_upload
		and selva.in_token_scope(proj.org_id)
	);
$$;

create or replace function selva.is_definition_editor(g uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
	select exists (
		select 1 from selva.definitions d
		where d.guid = g and d.deleted_at is null and selva.is_project_editor(d.project_id)
	);
$$;

create or replace function selva.is_definition_contributor(g uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
	select exists (
		select 1 from selva.definitions d
		where d.guid = g and d.deleted_at is null
		and selva.is_commons_contributor(d.project_id, d.owner_id)
	);
$$;

-- The window closes when a version is attached.
create or replace function selva.is_unfinished_commons_upload(g uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
	select exists (
		select 1 from selva.definitions d
		where d.guid = g and d.deleted_at is null
		and d.live_version_id is null and d.draft_version_id is null
		and selva.may_upload_to_commons(d.project_id, d.owner_id)
	);
$$;

drop policy if exists "definitions: editors can insert" on selva.definitions;
create policy "definitions: editors can insert"
on selva.definitions for insert
to authenticated
with check (
	selva.is_instance_admin()
	or selva.is_project_editor(project_id)
	or selva.may_upload_to_commons(project_id, owner_id)
);

drop policy if exists "definitions: editors can update" on selva.definitions;
create policy "definitions: editors can update"
on selva.definitions for update
to authenticated
using (
	selva.is_instance_admin()
	or selva.is_project_editor(project_id)
	or selva.is_commons_contributor(project_id, owner_id)
	or selva.is_unfinished_commons_upload(guid)
)
with check (
	selva.is_instance_admin()
	or selva.is_project_editor(project_id)
	or selva.is_commons_contributor(project_id, owner_id)
	or selva.may_upload_to_commons(project_id, owner_id)
);

drop policy if exists "definitions: editors can delete" on selva.definitions;
create policy "definitions: editors can delete"
on selva.definitions for delete
to authenticated
using (
	selva.is_instance_admin()
	or selva.is_project_editor(project_id)
	or selva.is_commons_contributor(project_id, owner_id)
	or selva.is_unfinished_commons_upload(guid)
);

drop policy if exists "definition_versions: editors can insert" on selva.definition_versions;
create policy "definition_versions: editors can insert"
on selva.definition_versions for insert
to authenticated
with check (
	selva.is_instance_admin()
	or selva.is_definition_editor(definition_guid)
	or (
		uploaded_by = auth.uid()
		and (
			selva.is_definition_contributor(definition_guid)
			or selva.is_unfinished_commons_upload(definition_guid)
		)
	)
);

drop policy if exists "definition_versions: editors can update" on selva.definition_versions;
create policy "definition_versions: editors can update"
on selva.definition_versions for update
to authenticated
using (selva.is_instance_admin() or selva.is_definition_editor(definition_guid))
with check (selva.is_instance_admin() or selva.is_definition_editor(definition_guid));

drop policy if exists "definition_versions: editors can delete" on selva.definition_versions;
create policy "definition_versions: editors can delete"
on selva.definition_versions for delete
to authenticated
using (
	selva.is_instance_admin()
	or selva.is_definition_editor(definition_guid)
	or selva.is_definition_contributor(definition_guid)
	or selva.is_unfinished_commons_upload(definition_guid)
);

drop policy if exists "share_links: editors can read" on selva.share_links;
create policy "share_links: editors can read"
on selva.share_links for select
to authenticated
using (
	selva.is_instance_admin()
	or selva.is_definition_editor(definition_guid)
	or selva.is_definition_contributor(definition_guid)
);

drop policy if exists "share_links: editors can insert" on selva.share_links;
create policy "share_links: editors can insert"
on selva.share_links for insert
to authenticated
with check (
	selva.is_instance_admin()
	or selva.is_definition_editor(definition_guid)
	or selva.is_definition_contributor(definition_guid)
);

drop policy if exists "share_links: editors can revoke" on selva.share_links;
create policy "share_links: editors can revoke"
on selva.share_links for update
to authenticated
using (
	selva.is_instance_admin()
	or selva.is_definition_editor(definition_guid)
	or selva.is_definition_contributor(definition_guid)
)
with check (
	selva.is_instance_admin()
	or selva.is_definition_editor(definition_guid)
	or selva.is_definition_contributor(definition_guid)
);

-- ----------------------------------------------------------------------------
-- 3. Org roles follow `canChangeOrgRole`
-- ----------------------------------------------------------------------------

-- `member` is the only standing an admin may hand out or take away, on the row
-- as it stands and on the row as it ends up.
create or replace function selva.may_set_org_role(o uuid, r text)
returns boolean
language sql stable security definer set search_path = public
as $$
	select selva.is_instance_admin()
		or selva.is_org_owner(o)
		or (r = 'member' and selva.is_org_admin(o));
$$;

drop policy if exists "org_members: admins can insert" on selva.org_members;
create policy "org_members: admins can insert"
on selva.org_members for insert
to authenticated
with check (selva.may_set_org_role(org_id, role));

drop policy if exists "org_members: admins can update" on selva.org_members;
create policy "org_members: admins can update"
on selva.org_members for update
to authenticated
using (selva.may_set_org_role(org_id, role))
with check (selva.may_set_org_role(org_id, role));

drop policy if exists "org_members: admins can delete" on selva.org_members;
create policy "org_members: admins can delete"
on selva.org_members for delete
to authenticated
using (selva.may_set_org_role(org_id, role));

drop policy if exists "orgs: authenticated can create their own" on selva.orgs;
create policy "orgs: authenticated can create their own"
on selva.orgs for insert
to authenticated
with check (
	selva.is_instance_admin()
	or (owner_id = auth.uid() and selva.delegated_org() is null)
);

-- ----------------------------------------------------------------------------
-- 4. Invites carry authority, so they get the same checks as granting it
-- ----------------------------------------------------------------------------

-- accept-invite applies a row's role and platform permissions through the
-- service role, so whoever can shape the row picks what the invitee receives.
create or replace function selva.may_issue_invite(o uuid, r text, platform text[])
returns boolean
language sql stable security definer set search_path = public
as $$
	select selva.has_org_permission(o, 'manage_org_members')
		and selva.may_set_org_role(o, r)
		and (cardinality(platform) = 0 or selva.is_instance_admin());
$$;

drop policy if exists "invites: manage_org_members can insert" on selva.invites;
create policy "invites: manage_org_members can insert"
on selva.invites for insert
to authenticated
with check (selva.may_issue_invite(org_id, org_role, platform_permissions));

drop policy if exists "invites: manage_org_members can delete" on selva.invites;
create policy "invites: manage_org_members can delete"
on selva.invites for delete
to authenticated
using (selva.may_issue_invite(org_id, org_role, platform_permissions));

-- A pending invite is immutable apart from being accepted.
revoke update on selva.invites from anon, authenticated;
grant update (accepted_at, accepted_by_user_id) on selva.invites to authenticated;

-- ----------------------------------------------------------------------------
-- 5. Profiles and tokens
-- ----------------------------------------------------------------------------

create or replace function selva.shares_org_with(u uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
	select exists (
		select 1
		from selva.org_members mine
		join selva.org_members theirs on theirs.org_id = mine.org_id
		where mine.user_id = auth.uid() and mine.deleted_at is null
		and theirs.user_id = u and theirs.deleted_at is null
		and selva.in_token_scope(mine.org_id)
	);
$$;

-- The app reads other users' profiles with the service role, so this only limits
-- direct REST.
drop policy if exists "user_profiles: any authenticated can read" on selva.user_profiles;
create policy "user_profiles: self and shared orgs can read"
on selva.user_profiles for select
to authenticated
using (user_id = auth.uid() or selva.is_instance_admin() or selva.shares_org_with(user_id));

drop policy if exists "api_tokens: owner or org leadership can revoke" on selva.api_tokens;
create policy "api_tokens: owner or org leadership can revoke"
on selva.api_tokens for update
to authenticated
using (
	(user_id = auth.uid() and selva.in_token_scope(org_id))
	or selva.has_org_permission(org_id, 'manage_org_members')
)
with check (
	revoked_at is not null
	and (
		(user_id = auth.uid() and selva.in_token_scope(org_id))
		or selva.has_org_permission(org_id, 'manage_org_members')
	)
);

-- ----------------------------------------------------------------------------
-- 6. Removing an org member reaches rows the acting admin cannot see
-- ----------------------------------------------------------------------------

-- RLS hides private projects from an org admin who is not in them, so a cascade
-- run as that admin would leave the leaver's project access intact and report
-- success. Definer rights reach those rows, and one transaction ends both
-- memberships together.
create or replace function selva.remove_org_member(o uuid, u uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
	target_role text;
begin
	select role into target_role
	from selva.org_members
	where org_id = o and user_id = u and deleted_at is null
	for update;
	if not found then
		raise exception 'Org member not found' using errcode = 'P0002';
	end if;

	if auth.jwt() ->> 'role' is distinct from 'service_role'
		and not selva.may_set_org_role(o, target_role) then
		raise exception 'No permission to remove this member' using errcode = '42501';
	end if;

	update selva.project_members m
	set deleted_at = now(), updated_at = now(), updated_by = coalesce(auth.uid(), m.updated_by)
	from selva.projects p
	where p.id = m.project_id and p.org_id = o and m.user_id = u and m.deleted_at is null;

	update selva.org_members m
	set deleted_at = now(), updated_at = now(), updated_by = coalesce(auth.uid(), m.updated_by)
	where m.org_id = o and m.user_id = u and m.deleted_at is null;
end;
$$;

revoke all on function selva.remove_org_member(uuid, uuid) from public, anon;
grant execute on function selva.remove_org_member(uuid, uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 7. The share-link roster reaches every project in the org
-- ----------------------------------------------------------------------------

create or replace function selva.leads_definition_org(g uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
	select exists (
		select 1
		from selva.definitions d
		join selva.projects p on p.id = d.project_id
		where d.guid = g and d.deleted_at is null and p.deleted_at is null
		and selva.has_org_permission(p.org_id, 'manage_org_members')
	);
$$;

drop policy if exists "share_links: org leadership can read the roster" on selva.share_links;
create policy "share_links: org leadership can read the roster"
on selva.share_links for select
to authenticated
using (selva.leads_definition_org(definition_guid));

-- A definer function, not a policy: the roster embeds `definitions` and
-- `projects`, whose own RLS hides private projects from the leadership reading
-- it, and those are the links offboarding has to find.
create or replace function selva.org_share_link_roster(o uuid, page_limit integer, page_offset integer)
returns table (
	id uuid,
	definition_guid uuid,
	channel text,
	token_hash text,
	name text,
	created_by uuid,
	created_at timestamptz,
	expires_at timestamptz,
	revoked_at timestamptz,
	allow_solve boolean,
	max_solves integer,
	solve_count integer,
	definition_name text,
	project_id uuid,
	project_name text,
	total_count bigint
)
language plpgsql stable security definer set search_path = public
as $$
begin
	if auth.jwt() ->> 'role' is distinct from 'service_role'
		and not selva.has_org_permission(o, 'manage_org_members') then
		raise exception 'No permission to read this roster' using errcode = '42501';
	end if;

	return query
	select l.id, l.definition_guid, l.channel, l.token_hash, l.name, l.created_by, l.created_at,
		l.expires_at, l.revoked_at, l.allow_solve, l.max_solves, l.solve_count,
		d.display_name, p.id, p.name, count(*) over ()
	from selva.share_links l
	join selva.definitions d on d.guid = l.definition_guid and d.deleted_at is null
	join selva.projects p on p.id = d.project_id and p.deleted_at is null
	where p.org_id = o
	and l.revoked_at is null
	and (l.expires_at is null or l.expires_at > now())
	order by l.created_at desc
	limit page_limit offset page_offset;
end;
$$;

revoke all on function selva.org_share_link_roster(uuid, integer, integer) from public, anon;
grant execute on function selva.org_share_link_roster(uuid, integer, integer)
	to authenticated, service_role;
