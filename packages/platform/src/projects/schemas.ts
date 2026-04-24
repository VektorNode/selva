import { z } from 'zod';
import { GuidSchema } from '../definitions/schemas.js';
import { SlugSchema } from '../organizations/schemas.js';

export const ProjectVisibilitySchema = z.enum(['public', 'org', 'private']);
export type ProjectVisibility = z.infer<typeof ProjectVisibilitySchema>;

export const ProjectRoleSchema = z.enum(['owner', 'editor', 'viewer']);
export type ProjectRole = z.infer<typeof ProjectRoleSchema>;

export const CreateProjectSchema = z
	.object({
		orgId: GuidSchema,
		name: z.string().min(1, 'Project name is required').max(128),
		slug: SlugSchema,
		description: z.string().max(2000).optional(),
		visibility: ProjectVisibilitySchema,
		autoJoinOnUpload: z.boolean().default(false),
		allowAnonymous: z.boolean().default(false)
	})
	.superRefine((v, ctx) => {
		if (v.autoJoinOnUpload && v.visibility !== 'public') {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ['autoJoinOnUpload'],
				message: 'autoJoinOnUpload requires visibility=public'
			});
		}
		if (v.allowAnonymous && v.visibility !== 'public') {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ['allowAnonymous'],
				message: 'allowAnonymous requires visibility=public'
			});
		}
	});

/**
 * PATCH shape-only. The flag/visibility invariant is cross-field on the
 * *merged* shape; handlers must call `validateProjectFlags` after applying
 * the patch to the current project.
 */
export const UpdateProjectSchema = z
	.object({
		name: z.string().min(1).max(128),
		slug: SlugSchema,
		description: z
			.string()
			.max(2000)
			.nullish()
			.transform((v) => v ?? undefined),
		visibility: ProjectVisibilitySchema,
		autoJoinOnUpload: z.boolean(),
		allowAnonymous: z.boolean()
	})
	.partial();

/** Cross-field check for PATCH flows. Call on the merged post-patch shape. */
export function validateProjectFlags(merged: {
	visibility: ProjectVisibility;
	autoJoinOnUpload?: boolean;
	allowAnonymous?: boolean;
}): { path: string; message: string }[] {
	const issues: { path: string; message: string }[] = [];
	if (merged.autoJoinOnUpload && merged.visibility !== 'public') {
		issues.push({
			path: 'autoJoinOnUpload',
			message: 'autoJoinOnUpload requires visibility=public'
		});
	}
	if (merged.allowAnonymous && merged.visibility !== 'public') {
		issues.push({
			path: 'allowAnonymous',
			message: 'allowAnonymous requires visibility=public'
		});
	}
	return issues;
}

export type CreateProjectInput = z.infer<typeof CreateProjectSchema>;
export type UpdateProjectInput = z.infer<typeof UpdateProjectSchema>;
