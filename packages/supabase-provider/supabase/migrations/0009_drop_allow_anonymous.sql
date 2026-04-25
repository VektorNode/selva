-- Drop the `allow_anonymous` project flag.
--
-- Per Permissions.md spec update: anonymous access is no longer a
-- project-level toggle. It's delivered via per-definition share-link
-- tokens (§7), which carry per-link caps, expiry, and revocation. The
-- flag was always gated behind unimplemented abuse controls and is now
-- replaced by the share-link mechanism entirely.
--
-- The CHECK constraint `projects_flags_require_public` paired the flag
-- with `auto_join_on_upload`. Drop and replace with a constraint that
-- only references the surviving flag.

alter table public.projects
	drop constraint if exists projects_flags_require_public;

alter table public.projects
	drop column if exists allow_anonymous;

alter table public.projects
	add constraint projects_commons_requires_public check (
		auto_join_on_upload = false or visibility = 'public'
	);
