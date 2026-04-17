import { z } from 'zod';
import { GuidSchema } from '../definitions/schemas.js';

// ── Shared primitives ─────────────────────────────────────────────────────────

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

// ── Organization schemas ──────────────────────────────────────────────────────

export const OrgRoleSchema = z.enum(['owner', 'admin', 'member']);

export const CreateOrgSchema = z.object({
	name: z.string().min(1, 'Organization name is required').max(128),
	slug: SlugSchema
});

export const UpdateOrgSchema = CreateOrgSchema.partial();

// ── Project schemas ───────────────────────────────────────────────────────────

export const ProjectVisibilitySchema = z.enum(['public', 'org', 'private']);

export const ProjectRoleSchema = z.enum(['owner', 'editor', 'viewer']);

export const CreateProjectSchema = z.object({
	orgId: GuidSchema,
	name: z.string().min(1, 'Project name is required').max(128),
	slug: SlugSchema,
	description: z.string().max(2000).optional(),
	visibility: ProjectVisibilitySchema
});

export const UpdateProjectSchema = z
	.object({
		name: z.string().min(1).max(128),
		slug: SlugSchema,
		description: z
			.string()
			.max(2000)
			.nullish()
			.transform((v) => v ?? undefined),
		visibility: ProjectVisibilitySchema
	})
	.partial();

// ── Inferred types ────────────────────────────────────────────────────────────

export type CreateOrgInput = z.infer<typeof CreateOrgSchema>;
export type UpdateOrgInput = z.infer<typeof UpdateOrgSchema>;
export type CreateProjectInput = z.infer<typeof CreateProjectSchema>;
export type UpdateProjectInput = z.infer<typeof UpdateProjectSchema>;
