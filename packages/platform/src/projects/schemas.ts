import { z } from 'zod';
import { GuidSchema } from '../definitions/schemas.js';
import { SlugSchema } from '../organizations/schemas.js';

export const ProjectVisibilitySchema = z.enum(['public', 'org', 'private']);
export type ProjectVisibility = z.infer<typeof ProjectVisibilitySchema>;

export const ProjectRoleSchema = z.enum(['owner', 'editor', 'viewer']);
export type ProjectRole = z.infer<typeof ProjectRoleSchema>;

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

export type CreateProjectInput = z.infer<typeof CreateProjectSchema>;
export type UpdateProjectInput = z.infer<typeof UpdateProjectSchema>;
