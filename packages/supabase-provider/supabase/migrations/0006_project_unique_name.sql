-- Enforce case-insensitive unique project names per org.
--
-- Previously only `(org_id, slug)` was unique, so the create-project handler
-- silently auto-suffixed the slug on collision and allowed two projects with
-- the same display name in the same org — which users can't tell apart in the
-- UI. This migration makes the name itself the source of uniqueness.
--
-- Pre-existing duplicates are renamed in place with a numeric suffix ("Foo",
-- "Foo (2)", "Foo (3)", …) ordered by created_at so the oldest keeps the
-- original name. This lets the new unique index be created without manual
-- cleanup in dev/staging DBs that already contain duplicates.

with ranked as (
	select
		id,
		name,
		row_number() over (
			partition by org_id, lower(name)
			order by created_at, id
		) as rn
	from public.projects
)
update public.projects p
set name = r.name || ' (' || r.rn || ')'
from ranked r
where p.id = r.id and r.rn > 1;

create unique index if not exists projects_org_name_unique
	on public.projects (org_id, lower(name));
