import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getOrganizationProvider, getProjectProvider, flag } from '$lib/server/providers.server';
import { requireManageProjects, requireCanManage } from '$lib/server/access.server';
import { handleApiError, throwZodError } from '$lib/server/api-errors';
import { slugify } from '$lib/server/slug';
import {
	ProjectVisibilitySchema,
	canChangeVisibilityToPublic,
	hasPermission,
	validateProjectFlags,
	withAdminBypass
} from '@selva/platform';

const UpdateProjectBody = z
	.object({
		name: z.string().min(1).max(128).trim(),
		description: z.string().max(2000).nullish(),
		visibility: ProjectVisibilitySchema,
		autoJoinOnUpload: z.boolean(),
		allowAnonymous: z.boolean()
	})
	.partial();

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const { id } = params;
	if (!id) throw error(400, 'Missing project ID');

	requireManageProjects(locals);
	const ctx = locals.ctx!;
	const allowed = await getProjectProvider().canEditProjectSettings(ctx, id);
	if (!allowed) throw error(403, 'You do not have permission to edit this project.');

	const body = await request.json().catch(() => null);
	const parsed = UpdateProjectBody.safeParse(body);
	if (!parsed.success) throwZodError(parsed.error);

	// Load the current project state so we can reason about the merged shape:
	// the flag/visibility invariant depends on both the patch and what's already
	// there (you can set autoJoinOnUpload=true only if visibility stays public).
	const existing = await getProjectProvider().getProject(ctx, id);
	if (!existing) throw error(404, 'Project not found');

	// A6: flipping visibility *to* public is a disclosure action — stricter gate.
	if (
		parsed.data.visibility !== undefined &&
		parsed.data.visibility === 'public' &&
		existing.visibility !== 'public'
	) {
		const orgMember = await getOrganizationProvider().getOrgMember(
			ctx,
			existing.orgId,
			ctx.userId
		);
		const passes = withAdminBypass(ctx.platformPermissions, () =>
			canChangeVisibilityToPublic({
				platformPermissions: ctx.platformPermissions,
				orgMember,
				allowCrossOrgPublic: flag('ALLOW_CROSS_ORG_PUBLIC')
			})
		);
		if (!passes) {
			throw error(
				403,
				flag('ALLOW_CROSS_ORG_PUBLIC')
					? 'Only org owners or admins can make a project public.'
					: 'Cross-org public projects are disabled on this instance.'
			);
		}
	}

	// Flag invariant: autoJoinOnUpload / allowAnonymous require visibility=public.
	// Evaluate against the *merged* post-patch shape so partial updates behave.
	const mergedVisibility = parsed.data.visibility ?? existing.visibility;
	const mergedAutoJoin = parsed.data.autoJoinOnUpload ?? existing.autoJoinOnUpload;
	const mergedAllowAnon = parsed.data.allowAnonymous ?? existing.allowAnonymous;
	const flagIssues = validateProjectFlags({
		visibility: mergedVisibility,
		autoJoinOnUpload: mergedAutoJoin,
		allowAnonymous: mergedAllowAnon
	});
	if (flagIssues.length > 0) {
		throw error(400, flagIssues.map((i) => `${i.path}: ${i.message}`).join('; '));
	}

	const patch: {
		name?: string;
		slug?: string;
		description?: string;
		visibility?: 'public' | 'org' | 'private';
		autoJoinOnUpload?: boolean;
		allowAnonymous?: boolean;
	} = {};
	if (parsed.data.name !== undefined) {
		patch.name = parsed.data.name;
		patch.slug = slugify(parsed.data.name);
	}
	if (parsed.data.description !== undefined) {
		patch.description = parsed.data.description ?? undefined;
	}
	if (parsed.data.visibility !== undefined) patch.visibility = parsed.data.visibility;
	if (parsed.data.autoJoinOnUpload !== undefined) {
		patch.autoJoinOnUpload = parsed.data.autoJoinOnUpload;
	}
	if (parsed.data.allowAnonymous !== undefined) {
		patch.allowAnonymous = parsed.data.allowAnonymous;
	}

	try {
		await getProjectProvider().updateProject(ctx, id, patch);
		return json({ success: true });
	} catch (err) {
		handleApiError(err, 'Failed to update project');
	}

	// Unused import guarded to satisfy lint — hasPermission is exported in case
	// future gates compose with platform permissions directly.
	void hasPermission;
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	const { id } = params;
	if (!id) throw error(400, 'Missing project ID');
	await requireCanManage(locals, id);
	const ctx = locals.ctx!;

	try {
		await getProjectProvider().deleteProject(ctx, id);
		return json({ success: true });
	} catch (err) {
		handleApiError(err, 'Failed to delete project');
	}
};
