import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getOrganizationProvider, getProjectProvider } from '$lib/server/providers.server';
import { requireCanManage, requireCanEditProjectSettings } from '$lib/server/access.server';
import { handleApiError, throwZodError } from '$lib/server/api-errors';
import { slugify } from '$lib/server/slug';
import {
	ProjectVisibilitySchema,
	canChangeVisibilityToPublic,
	validateProjectFlags,
	withAdminBypass
} from '@selva/platform';

const UpdateProjectBody = z
	.object({
		name: z.string().min(1).max(128).trim(),
		description: z.string().max(2000).nullish(),
		visibility: ProjectVisibilitySchema,
		autoJoinOnUpload: z.boolean()
	})
	.partial();

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const { id } = params;
	if (!id) throw error(400, 'Missing project ID');

	// `requireCanEditProjectSettings` is owner-only at the project level — that
	// IS the gate for editing settings. The platform-scope `manage_projects`
	// check that used to live here was redundant for org owners/admins (they
	// always carry it via DEFAULT_ORG_PERMISSIONS) and a regression for plain
	// org members who happened to own a project — they'd hit 403 on their own
	// project's settings.
	const { ctx, project: existing } = await requireCanEditProjectSettings(locals, id);

	const body = await request.json().catch(() => null);
	const parsed = UpdateProjectBody.safeParse(body);
	if (!parsed.success) throwZodError(parsed.error);

	// Flipping *to* public is a disclosure action — stricter gate than a normal edit.
	if (
		parsed.data.visibility !== undefined &&
		parsed.data.visibility === 'public' &&
		existing.visibility !== 'public'
	) {
		const orgMember = await getOrganizationProvider().getOrgMember(ctx, existing.orgId, ctx.userId);
		const passes = withAdminBypass(ctx.platformPermissions, () =>
			canChangeVisibilityToPublic({
				platformPermissions: ctx.platformPermissions,
				orgMember
			})
		);
		if (!passes) {
			throw error(403, 'Only org owners or admins can make a project public.');
		}
	}

	// Flag/visibility invariant runs on the merged post-patch shape so partial
	// updates are validated correctly.
	const mergedVisibility = parsed.data.visibility ?? existing.visibility;
	const mergedAutoJoin = parsed.data.autoJoinOnUpload ?? existing.autoJoinOnUpload;
	const flagIssues = validateProjectFlags({
		visibility: mergedVisibility,
		autoJoinOnUpload: mergedAutoJoin
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

	try {
		await getProjectProvider().updateProject(ctx, id, patch);
		return json({ success: true });
	} catch (err) {
		handleApiError(err, 'Failed to update project');
	}
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
