import { z } from 'zod';

/**
 * URL-safe slug: lowercase alphanumeric with hyphens allowed in the middle.
 * 3–63 characters. No leading/trailing/consecutive hyphens.
 * Examples: "acme-corp", "my-project", "abc"
 */
export const SlugSchema = z
	.string()
	.min(3, 'Slug must be at least 3 characters')
	.max(63, 'Slug must be at most 63 characters')
	.regex(
		/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/,
		'Slug must be lowercase alphanumeric with hyphens (no leading/trailing/consecutive hyphens)'
	);

export const OrgRoleSchema = z.enum(['owner', 'admin', 'member']);
export type OrgRole = z.infer<typeof OrgRoleSchema>;

/**
 * Org-scope permissions. Apply *within a single organization* only —
 * never across orgs. A user may hold different OrgPermissions in different
 * orgs they belong to.
 */
export const OrgPermissionSchema = z.enum([
	'manage_users', // invite / remove / role-change within THIS org
	'manage_compute', // configure compute servers for THIS org
	'manage_definitions', // create / edit / delete defs in THIS org
	'manage_projects' // create / edit / delete projects in THIS org
]);
export type OrgPermission = z.infer<typeof OrgPermissionSchema>;

/** Convenience: every org permission. */
export const ALL_ORG_PERMISSIONS: readonly OrgPermission[] = OrgPermissionSchema.options;

/**
 * Permissions reserved for owner/admin roles and never grantable to `member`.
 * Members run the day-to-day work (definitions, projects); governance
 * (inviting users, configuring compute servers) is owner/admin territory.
 */
export const OWNER_ADMIN_ONLY_PERMISSIONS: readonly OrgPermission[] = [
	'manage_users',
	'manage_compute'
];

/** Org permissions that a `member` role is allowed to hold. */
export const MEMBER_ASSIGNABLE_PERMISSIONS: readonly OrgPermission[] = ALL_ORG_PERMISSIONS.filter(
	(p) => !OWNER_ADMIN_ONLY_PERMISSIONS.includes(p)
);

/**
 * Default OrgPermission[] granted to each role. Roles are the user-facing
 * primitive; permissions are what the adapters check. These defaults are
 * applied by the local provider when a member is added without an explicit
 * permissions list; Supabase can seed via a trigger on `org_members` insert.
 */
export const DEFAULT_ORG_PERMISSIONS: Record<OrgRole, readonly OrgPermission[]> = {
	owner: [...ALL_ORG_PERMISSIONS],
	admin: [...ALL_ORG_PERMISSIONS],
	member: []
};

export const CreateOrgSchema = z.object({
	name: z.string().min(1, 'Organization name is required').max(128),
	slug: SlugSchema
});

export const UpdateOrgSchema = CreateOrgSchema.partial();

export type CreateOrgInput = z.infer<typeof CreateOrgSchema>;
export type UpdateOrgInput = z.infer<typeof UpdateOrgSchema>;
