import { z } from 'zod';
import { GuidSchema } from '../definitions/schemas.js';
import { SlugSchema } from '../organizations/schemas.js';

export const ProjectVisibilitySchema = z.enum(['public', 'org', 'private']);
export type ProjectVisibility = z.infer<typeof ProjectVisibilitySchema>;

export const ProjectRoleSchema = z.enum(['owner', 'editor', 'viewer']);
export type ProjectRole = z.infer<typeof ProjectRoleSchema>;

/**
 * Create schema. Both commons/anonymous flags are optional and default to
 * `false`; the refinement below rejects enabling them on non-public projects
 * so the invariant is enforced at the API boundary as well as the rule layer.
 */
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
 * Update schema. All fields optional. The combined-shape refinement runs on
 * the *patched* intent; callers must merge with the current project before
 * validating to get a correct cross-field check. In practice, handlers do:
 *   const merged = { ...project, ...patch };
 *   UpdateProjectSchema.parse(patch); // shape check
 *   validateFlagsAgainstVisibility(merged); // see helper below
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

/**
 * Helper for handlers: validate that commons/anonymous flags are only enabled
 * on `public` projects, given a merged (post-patch) shape. Returns a Zod-style
 * issue list or an empty array.
 */
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
