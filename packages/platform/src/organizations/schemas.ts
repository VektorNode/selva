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
 * Org-scope permissions. Apply within a single organization only; a user may
 * hold different ones in different orgs they belong to.
 */
export const OrgPermissionSchema = z.enum([
	'manage_org_members',
	'manage_org_compute',
	'manage_definitions',
	'manage_projects'
]);
export type OrgPermission = z.infer<typeof OrgPermissionSchema>;

export const ALL_ORG_PERMISSIONS: readonly OrgPermission[] = OrgPermissionSchema.options;

/** Governance perms — never grantable to `member`. */
export const OWNER_ADMIN_ONLY_PERMISSIONS: readonly OrgPermission[] = [
	'manage_org_members',
	'manage_org_compute'
];

export const MEMBER_ASSIGNABLE_PERMISSIONS: readonly OrgPermission[] = ALL_ORG_PERMISSIONS.filter(
	(p) => !OWNER_ADMIN_ONLY_PERMISSIONS.includes(p)
);

/**
 * Applied when adding a member without an explicit permissions list. Roles
 * are the user-facing primitive; permissions are what adapters check.
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
