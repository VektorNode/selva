import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import {
	getOrganizationProvider,
	getPlatformProjectGrantStore,
	getProjectProvider
} from '$lib/server/providers.server';
import {
	requireCanManage,
	requireCanEditProjectSettings,
	projectAccessInputFromRows
} from '$lib/server/access.server';
import { handleApiError, throwZodError, apiError, ApiErrorCode } from '$lib/server/api-errors';
import { slugify, SYSTEM_CONTEXT, canView, canEdit, canSolve } from '@selvajs/platform';
import {
	ProjectVisibilitySchema,
	canChangeVisibilityToPublic,
	validateProjectFlags,
	withAdminBypass
} from '@selvajs/platform';

/**
 * Project detail plus the caller's effective capabilities on it.
 *
 * A project the caller cannot view returns 404, not 403 — `403` would confirm
 * the id exists to anyone probing.
 */
export const GET: RequestHandler = async ({ params, locals }) => {
	const { id } = params;
	if (!id) apiError(400, ApiErrorCode.VALIDATION_FAILED, 'Missing project ID');
	if (!locals.ctx) apiError(401, ApiErrorCode.UNAUTHORIZED, 'Unauthorized');
	const ctx = locals.ctx;

	try {
		const project = await getProjectProvider().getProject(SYSTEM_CONTEXT, id);
		if (!project) apiError(404, ApiErrorCode.NOT_FOUND, 'Project not found');

		const [orgMembers, projectMembers, grants] = await Promise.all([
			getOrganizationProvider().getOrgMembersFor(SYSTEM_CONTEXT, [project.orgId], ctx.userId),
			getProjectProvider().getProjectMembersFor(SYSTEM_CONTEXT, [project.id], ctx.userId),
			project.visibility === 'platform'
				? getPlatformProjectGrantStore().listByProject(SYSTEM_CONTEXT, project.id)
				: Promise.resolve([])
		]);

		const member = projectMembers.get(project.id) ?? null;
		const input = projectAccessInputFromRows(ctx, project, {
			member,
			orgMember: orgMembers.get(project.orgId) ?? null,
			platformGrants: grants
		});
		if (!canView(input)) apiError(404, ApiErrorCode.NOT_FOUND, 'Project not found');

		return json({
			...project,
			role: member?.role ?? null,
			canEdit: canEdit(input),
			canSolve: canSolve(input)
		});
	} catch (err) {
		handleApiError(err, 'Failed to load project');
	}
};

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
	if (!id) apiError(400, ApiErrorCode.VALIDATION_FAILED, 'Missing project ID');

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
			canChangeVisibilityToPublic({ orgMember })
		);
		if (!passes) {
			apiError(403, ApiErrorCode.FORBIDDEN, 'Only org owners or admins can make a project public.');
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
		apiError(
			400,
			ApiErrorCode.VALIDATION_FAILED,
			flagIssues.map((i) => `${i.path}: ${i.message}`).join('; ')
		);
	}

	const patch: {
		name?: string;
		slug?: string;
		description?: string;
		visibility?: 'public' | 'org' | 'private' | 'platform';
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
		return new Response(null, { status: 204 });
	} catch (err) {
		handleApiError(err, 'Failed to update project');
	}
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	const { id } = params;
	if (!id) apiError(400, ApiErrorCode.VALIDATION_FAILED, 'Missing project ID');
	await requireCanManage(locals, id);
	const ctx = locals.ctx!;

	try {
		await getProjectProvider().deleteProject(ctx, id);
		return new Response(null, { status: 204 });
	} catch (err) {
		handleApiError(err, 'Failed to delete project');
	}
};
