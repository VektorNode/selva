import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
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
import { apiError, ApiErrorCode } from '$lib/server/api-errors';
import {
	slugify,
	SYSTEM_CONTEXT,
	canView,
	canEdit,
	canSolve,
	hasPermission,
	type ProjectVisibility
} from '@selvajs/platform';
import {
	canChangeVisibilityToPublic,
	validateProjectFlags,
	withAdminBypass
} from '@selvajs/platform';
import { UpdateProjectBodySchema } from '$lib/server/api/v1/bodies';
import {
	apiRoute,
	noContent,
	parseBody,
	requireCaller,
	requireParams
} from '$lib/server/api/v1/route';

/**
 * Project detail plus the caller's effective capabilities on it.
 *
 * A project the caller cannot view returns 404, not 403 — `403` would confirm
 * the id exists to anyone probing.
 */
export const GET: RequestHandler = apiRoute(
	'Failed to load project',
	async ({ params, locals }) => {
		const { id } = requireParams(params, 'id');
		const { ctx } = requireCaller(locals);

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
	}
);

export const PATCH: RequestHandler = apiRoute(
	'Failed to update project',
	async ({ params, request, locals }) => {
		const { id } = requireParams(params, 'id');

		// `requireCanEditProjectSettings` is owner-only at the project level — that
		// IS the gate for editing settings. The platform-scope `manage_projects`
		// check that used to live here was redundant for org owners/admins (they
		// always carry it via DEFAULT_ORG_PERMISSIONS) and a regression for plain
		// org members who happened to own a project — they'd hit 403 on their own
		// project's settings.
		const { ctx, project: existing } = await requireCanEditProjectSettings(locals, id);

		const input = await parseBody(request, UpdateProjectBodySchema);

		// `platform` takes a project out of its org entirely: no org member can
		// see it, `canReclaim` returns false forever, and with
		// ENABLE_PLATFORM_PROJECTS off (the default) every rule denies everyone,
		// including admins. Escalating into it must be instance-admin only.
		if (input.visibility === 'platform' && existing.visibility !== 'platform') {
			if (!hasPermission(ctx, 'instance_admin')) {
				apiError(
					403,
					ApiErrorCode.FORBIDDEN,
					'Only a platform admin can give a project platform visibility.'
				);
			}
		}

		// Flipping *to* public is a disclosure action — a stricter gate than a
		// normal edit.
		if (input.visibility === 'public' && existing.visibility !== 'public') {
			const orgMember = await getOrganizationProvider().getOrgMember(
				ctx,
				existing.orgId,
				ctx.userId
			);
			const passes = withAdminBypass(ctx.platformPermissions, () =>
				canChangeVisibilityToPublic({ orgMember })
			);
			if (!passes) {
				apiError(
					403,
					ApiErrorCode.FORBIDDEN,
					'Only org owners or admins can make a project public.'
				);
			}
		}

		// The flag/visibility invariant runs on the merged post-patch shape, so a
		// partial update is validated against what the project will become.
		const flagIssues = validateProjectFlags({
			visibility: input.visibility ?? existing.visibility,
			autoJoinOnUpload: input.autoJoinOnUpload ?? existing.autoJoinOnUpload
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
			visibility?: ProjectVisibility;
			autoJoinOnUpload?: boolean;
		} = {};
		// A renamed project gets a re-derived slug; the two must not drift apart.
		if (input.name !== undefined) {
			patch.name = input.name;
			patch.slug = slugify(input.name);
		}
		if (input.description !== undefined) patch.description = input.description ?? undefined;
		if (input.visibility !== undefined) patch.visibility = input.visibility;
		if (input.autoJoinOnUpload !== undefined) patch.autoJoinOnUpload = input.autoJoinOnUpload;

		await getProjectProvider().updateProject(ctx, id, patch);
		return noContent();
	}
);

export const DELETE: RequestHandler = apiRoute(
	'Failed to delete project',
	async ({ params, locals }) => {
		const { id } = requireParams(params, 'id');
		await requireCanManage(locals, id);

		await getProjectProvider().deleteProject(locals.ctx!, id);
		return noContent();
	}
);
