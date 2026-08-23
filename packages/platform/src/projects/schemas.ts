import { z } from 'zod';

export const ProjectVisibilitySchema = z.enum(['public', 'org', 'private', 'platform']);
export type ProjectVisibility = z.infer<typeof ProjectVisibilitySchema>;

export const ProjectRoleSchema = z.enum(['owner', 'editor', 'viewer']);
export type ProjectRole = z.infer<typeof ProjectRoleSchema>;

/** Cross-field check for PATCH flows. Call on the merged post-patch shape. */
export function validateProjectFlags(merged: {
	visibility: ProjectVisibility;
	autoJoinOnUpload?: boolean;
}): { path: string; message: string }[] {
	const issues: { path: string; message: string }[] = [];
	if (merged.autoJoinOnUpload && merged.visibility !== 'public') {
		issues.push({
			path: 'autoJoinOnUpload',
			message: 'autoJoinOnUpload requires visibility=public'
		});
	}
	if (merged.visibility === 'platform' && merged.autoJoinOnUpload) {
		issues.push({
			path: 'autoJoinOnUpload',
			message: 'autoJoinOnUpload is not allowed on platform projects'
		});
	}
	return issues;
}
