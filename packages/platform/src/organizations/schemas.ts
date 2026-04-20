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

export const CreateOrgSchema = z.object({
	name: z.string().min(1, 'Organization name is required').max(128),
	slug: SlugSchema
});

export const UpdateOrgSchema = CreateOrgSchema.partial();

export type CreateOrgInput = z.infer<typeof CreateOrgSchema>;
export type UpdateOrgInput = z.infer<typeof UpdateOrgSchema>;
