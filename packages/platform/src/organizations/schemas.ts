import { z } from 'zod';

/**
 * Top-level path segments a tenant slug must never equal, so a slug can never
 * shadow (or be shadowed by) a route (audit D4). Two forces meet here:
 *  - Reserved multi-org namespace: `/o/{slug}/` is the decided shape for
 *    per-org URLs (see ADR 0006). `o` is reserved even though the length gate
 *    below already makes a 1-char slug impossible — belt-and-suspenders, and it
 *    documents intent for anyone relaxing the length rule later.
 *  - Existing flat top-level routes: reserving these keeps a future move to
 *    `/o/{slug}/…` (or any flat tenant route) collision-free from day one,
 *    before any external link is minted against a slug.
 * Lowercase; the slug is lowercased/matched case-insensitively so `Admin` can't
 * slip through. Keep in sync with the route tree's top-level directories.
 */
export const RESERVED_SLUGS: readonly string[] = [
	'o',
	'api',
	'admin',
	'auth',
	'login',
	'logout',
	'setup',
	'team',
	'library',
	'projects',
	'accept-invite'
];

const RESERVED_SLUG_SET = new Set(RESERVED_SLUGS);

/**
 * Coerce an arbitrary name into a slug candidate: lowercase, non-alphanumeric
 * runs collapsed to single hyphens, trimmed of edge hyphens, capped at 63 chars.
 * Produces the shape `SlugSchema` validates — but does not itself guarantee
 * validity (a name of all-symbols yields `''`, and reserved words pass through);
 * run the result through `SlugSchema` where a valid slug is required.
 */
export function slugify(name: string): string {
	return name
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '')
		.slice(0, 63);
}

/** Lowercase alphanumeric with internal hyphens, 3–63 chars, not a reserved word. */
export const SlugSchema = z
	.string()
	.min(3, 'Slug must be at least 3 characters')
	.max(63, 'Slug must be at most 63 characters')
	.regex(
		/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/,
		'Slug must be lowercase alphanumeric with hyphens (no leading/trailing/consecutive hyphens)'
	)
	.refine((s) => !RESERVED_SLUG_SET.has(s), {
		message: 'Slug is reserved and cannot be used'
	});

export const OrgRoleSchema = z.enum(['owner', 'admin', 'member']);
export type OrgRole = z.infer<typeof OrgRoleSchema>;

/**
 * Kinds of org-scoped branding asset. Adding a new kind is a single entry here
 * — the storage path, upload route, store, and UI are all generic over it.
 */
export const OrgAssetKindSchema = z.enum(['logo', 'favicon']);
export type OrgAssetKind = z.infer<typeof OrgAssetKindSchema>;

export const ALL_ORG_ASSET_KINDS: readonly OrgAssetKind[] = OrgAssetKindSchema.options;

/** Org-scope permissions. A user may hold different sets in different orgs. */
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

/** Applied when adding a member without an explicit permissions list. */
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
