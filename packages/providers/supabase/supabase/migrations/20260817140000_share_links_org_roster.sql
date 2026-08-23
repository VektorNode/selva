-- ============================================================================
-- Org-wide share-link roster (spec §7, §10)
--
-- A share link is a bearer credential: the URL is the whole authentication.
-- Until now the only read was per-definition and required edit rights on that
-- definition, so "what currently reaches my org's data?" could only be
-- answered by walking every definition by hand. Offboarding depended on it.
--
-- Adds the read authority org leadership needs for that roster, plus the
-- index the link -> definition -> project join walks.
-- ============================================================================

-- Org leadership reads links across the whole tenant, including projects they
-- are not a member of. Deliberately SELECT-only and deliberately separate from
-- the editor policy above it: revoking still requires edit rights on the
-- parent definition, so seeing the roster never implies authority over it.
--
-- Gated on `manage_org_members` rather than `manage_projects`: this is the
-- offboarding permission, and the roster's purpose is answering "what did the
-- leaver leave behind?". `manage_projects` can be handed to a plain member
-- (§11), who has no business enumerating every credential in the tenant.
create policy "share_links: org leadership can read the roster"
on selva.share_links for select
to authenticated
using (
	exists (
		select 1
		from selva.definitions d
		join selva.projects p on p.id = d.project_id
		where d.guid = share_links.definition_guid
		and d.deleted_at is null
		and p.deleted_at is null
		and selva.has_org_permission(p.org_id, 'manage_org_members')
	)
);

-- The roster orders by created_at across the whole org, where the existing
-- index is per-definition. Partial on the same `revoked_at is null` predicate
-- the reads filter by.
create index if not exists idx_share_links_created
	on selva.share_links(created_at desc)
	where revoked_at is null;
