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
	if (!merged.autoJoinOnUpload) return [];
	if (merged.visibility === 'platform') {
		return [
			{ path: 'autoJoinOnUpload', message: 'autoJoinOnUpload is not allowed on platform projects' }
		];
	}
	if (merged.visibility !== 'public') {
		return [{ path: 'autoJoinOnUpload', message: 'autoJoinOnUpload requires visibility=public' }];
	}
	return [];
}
