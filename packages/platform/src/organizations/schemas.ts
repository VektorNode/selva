import { z } from 'zod';

/**
 * Top-level path segments a tenant slug must never equal, so a slug can never
 * shadow (or be shadowed by) a route. `o` is reserved for `/o/{slug}/` even though
 * the length gate below already makes a 1-char slug impossible.
 * `reserved-slugs.test.ts` in the selva app holds this to the route tree.
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
	'accept-invite',
	'docs',
	'mcp',
	'oauth'
];

const RESERVED_SLUG_SET = new Set(RESERVED_SLUGS);

// Latin letters NFKD leaves whole, so stripping marks can't fold them.
const LATIN_FOLDS: Record<string, string> = {
	ß: 'ss',
	æ: 'ae',
	œ: 'oe',
	ø: 'o',
	ł: 'l',
	đ: 'd',
	þ: 'th'
};
const LATIN_FOLD_CHARS = new RegExp(`[${Object.keys(LATIN_FOLDS).join('')}]`, 'g');

/**
 * Coerces an arbitrary name into a slug candidate. Does not guarantee a valid
 * slug — an all-symbols name yields `''`, and reserved words pass through
 * untouched — run the result through `SlugSchema` where validity matters.
 */
export function slugify(name: string): string {
	return name
		.normalize('NFKD')
		.replace(/\p{M}/gu, '')
		.trim()
		.toLowerCase()
		.replace(LATIN_FOLD_CHARS, (c) => LATIN_FOLDS[c] ?? c)
		.replace(/[^a-z0-9]+/g, '-')
		.slice(0, 63)
		.replace(/^-+|-+$/g, '');
}

/**
 * A slug for an org named without a slug of its own. Always passes `SlugSchema`;
 * throws if `fallback` doesn't.
 */
export function orgSlugFromName(name: string, fallback = 'default'): string {
	if (!SlugSchema.safeParse(fallback).success) {
		throw new Error(`Invalid fallback slug: ${JSON.stringify(fallback)}`);
	}
	const slug = slugify(name);
	if (slug.length < 3) return fallback;
	return RESERVED_SLUG_SET.has(slug) ? `${slug}-org` : slug;
}

/** Lowercase alphanumeric with internal hyphens, 3–63 chars, not a reserved word. */
export const SlugSchema = z
	.string()
	.min(3, 'Slug must be at least 3 characters')
	.max(63, 'Slug must be at most 63 characters')
	.regex(
		/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/,
		'Slug must be lowercase alphanumeric with hyphens (no leading or trailing hyphen)'
	)
	.refine((s) => !RESERVED_SLUG_SET.has(s), {
		message: 'Slug is reserved and cannot be used'
	});

export const OrgRoleSchema = z.enum(['owner', 'admin', 'member']);
export type OrgRole = z.infer<typeof OrgRoleSchema>;

/** Kinds of org-scoped branding asset. Adding a kind is a single entry here — path, upload route, store, and UI are all generic over it. */
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
	name: z
		.string()
		.trim()
		.min(1, 'Organization name is required')
		.max(128)
		// `trim()` leaves zero-width characters (format class), which render as nothing.
		.refine((s) => /[^\s\p{Cf}]/u.test(s), 'Organization name is required'),
	slug: SlugSchema
});

export const UpdateOrgSchema = CreateOrgSchema.partial();

export type CreateOrgInput = z.infer<typeof CreateOrgSchema>;
export type UpdateOrgInput = z.infer<typeof UpdateOrgSchema>;
