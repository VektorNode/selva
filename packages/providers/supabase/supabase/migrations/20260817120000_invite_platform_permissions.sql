-- ============================================================================
-- selva.invites.platform_permissions — instance-wide grants carried by an invite
-- ============================================================================
--
-- Invites could only ever grant org scope, so the sole way to create a second
-- instance admin was the admin-sets-password form on /admin/users — a form that
-- cannot exist under a header-auth/IdP deployment, where Selva never holds a
-- credential. Removing that form without this column would leave such a
-- deployment permanently stuck at one admin.
--
-- Empty for virtually every row: the mint route rejects a non-empty value unless
-- the caller already holds instance_admin, since anyone who can write here can
-- escalate past org scope.

alter table selva.invites
	add column if not exists platform_permissions text[] not null default '{}';
