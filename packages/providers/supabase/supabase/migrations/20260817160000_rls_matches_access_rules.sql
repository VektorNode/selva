-- ============================================================================
-- RLS re-enforces the access rules independently (audit finding 12)
--
-- `rules.ts` promises: "Mutating store methods MUST re-enforce the same
-- predicate independently (RLS in SQL, code in local/JSON)." Three policies
-- had drifted from the rule they are supposed to mirror.
--
-- The one that bites today is project mutation. `canManage` and
-- `canEditProjectSettings` both resolve to "project member with role=owner",
-- while the policies read `projects.owner_id`. Those agree right up until a
-- Reclaim: `POST /projects/{id}/reclaim` adds an owner-role `project_members`
-- row on purpose and deliberately does NOT demote `owner_id`, so afterwards
-- the app layer says yes and RLS says no. Renaming a reclaimed project fails
-- with an RLS violation on Supabase and succeeds on local — reclaim is
-- functionally broken for settings edits on exactly one provider.
--
-- Two divergences are deliberately NOT closed here; see the bottom of this
-- file for why (`platform` visibility, `ALLOW_CROSS_ORG_PUBLIC`).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Project mutation follows member role, not `owner_id`
-- ----------------------------------------------------------------------------

-- `owner_id` stays on the row: it records who created the project and drives
-- the `on delete cascade`. It is simply not the authority for "may I edit
-- this?" — `canManage(input)` is `member?.role === 'owner'`, and a project
-- can have several owners (reclaim adds one; so does the members API).
create or replace function selva.is_project_owner(p uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
	select exists (
		select 1 from selva.project_members
		where project_id = p
		and user_id = auth.uid()
		and role = 'owner'
		and deleted_at is null
	);
$$;

drop policy if exists "projects: owners can update" on selva.projects;
create policy "projects: owners can update"
on selva.projects for update
to authenticated
using (selva.is_instance_admin() or selva.is_project_owner(id))
with check (selva.is_instance_admin() or selva.is_project_owner(id));

drop policy if exists "projects: owners can delete" on selva.projects;
create policy "projects: owners can delete"
on selva.projects for delete
to authenticated
using (selva.is_instance_admin() or selva.is_project_owner(id));

-- The three `project_members` write policies inlined the same `owner_id`
-- lookup. Same substitution, and now they share the helper rather than three
-- copies of a subquery that has to keep agreeing with itself.
drop policy if exists "project_members: managers can insert" on selva.project_members;
create policy "project_members: managers can insert"
on selva.project_members for insert
to authenticated
with check (selva.is_instance_admin() or selva.is_project_owner(project_id));

drop policy if exists "project_members: managers can update" on selva.project_members;
create policy "project_members: managers can update"
on selva.project_members for update
to authenticated
using (selva.is_instance_admin() or selva.is_project_owner(project_id))
with check (selva.is_instance_admin() or selva.is_project_owner(project_id));

drop policy if exists "project_members: managers can delete" on selva.project_members;
create policy "project_members: managers can delete"
on selva.project_members for delete
to authenticated
using (selva.is_instance_admin() or selva.is_project_owner(project_id));

-- Two writes add an owner row for someone `is_project_owner` does not yet
-- cover, because the row being written is what would make it true:
--
--  * `createProject` inserts the project, then upserts the creator's own owner
--    row. `owner_id` still answers this correctly — it is set at creation, and
--    `user_id = auth.uid()` bounds it to the self-seeding case.
--  * Reclaim adds an org admin who was never a project member. That is the
--    entire point of the escape hatch, so RLS mirrors `canReclaim` (org
--    owner/admin, matching tenancy) instead of the project-owner rule.
--
-- Both are self-writes of an owner row, so they share one predicate.
create or replace function selva.may_seed_project_owner(p uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
	select exists (
		select 1 from selva.projects proj
		where proj.id = p
		and proj.deleted_at is null
		and (proj.owner_id = auth.uid() or selva.is_org_admin(proj.org_id))
	);
$$;

-- Both writes go through `addProjectMember`, which UPSERTs so a soft-deleted
-- row reactivates in place instead of throwing duplicate-key. Postgres checks
-- an upsert against the INSERT policy *and* the UPDATE policy, so a seeding
-- rule that only covers INSERT rejects the very first `createProject` — the
-- ON CONFLICT arm has no UPDATE policy to fall back on. Both arms, always.
drop policy if exists "project_members: seeding an owner row" on selva.project_members;
create policy "project_members: seeding an owner row"
on selva.project_members for insert
to authenticated
with check (
	user_id = auth.uid()
	and role = 'owner'
	and selva.may_seed_project_owner(project_id)
);

drop policy if exists "project_members: reactivating a seeded owner row" on selva.project_members;
create policy "project_members: reactivating a seeded owner row"
on selva.project_members for update
to authenticated
using (user_id = auth.uid() and selva.may_seed_project_owner(project_id))
with check (
	user_id = auth.uid()
	and role = 'owner'
	and selva.may_seed_project_owner(project_id)
);

-- ----------------------------------------------------------------------------
-- 2. The member roster is not part of project visibility
-- ----------------------------------------------------------------------------

-- The SELECT policy was `visible_project(project_id)`, which on a `public`
-- project means every authenticated user on the instance could enumerate the
-- roster. Seeing a project is not the same as seeing who is in it: §11 keeps
-- membership listings for leadership, and the app layer never offers the
-- roster to a non-member.
--
-- `is_project_member` covers the ordinary case (members see their peers) and
-- `is_org_admin` covers leadership, who manage membership and need to read it
-- to do so.
--
-- RLS alone would make Supabase quietly stricter than local, which is the drift
-- this migration exists to remove, only pointing the other way. The decision is
-- therefore also made at the route: `/projects` now loads the roster only for
-- projects the caller `canManage`, so both providers agree because neither
-- store is deciding. This policy is the backstop under that.
drop policy if exists "project_members: visible to project members" on selva.project_members;
create policy "project_members: visible to project members"
on selva.project_members for select
to authenticated
using (
	selva.is_instance_admin()
	or user_id = auth.uid()
	or selva.is_project_member(project_id)
	or exists (
		select 1 from selva.projects p
		where p.id = project_id and selva.is_org_admin(p.org_id)
	)
);

-- ----------------------------------------------------------------------------
-- Deliberately unchanged
-- ----------------------------------------------------------------------------
--
-- `visible_project` has no `platform` branch, and gets none here. The
-- `projects.visibility` CHECK constraint only admits public/org/private, and
-- `IPlatformProjectGrantStore` on Supabase is a stub that throws 501 — the
-- feature does not exist on this provider, so there is no grant table for a
-- policy to consult. Adding the branch is part of shipping platform projects
-- on Supabase, not part of closing a drift. Until then the CHECK fails closed.
--
-- `public` still ignores `ALLOW_CROSS_ORG_PUBLIC`, so with the flag off RLS
-- is more permissive than `canView`. Postgres cannot read the app's env, and
-- mirroring a deploy-time flag into the database means a second source of
-- truth that can disagree with the first — the failure mode is worse than the
-- one it fixes. The app layer stays authoritative for that flag; RLS remains
-- the backstop for everything that is a property of the data.
