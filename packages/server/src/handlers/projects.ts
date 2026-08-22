/**
 * Project handlers: the collection, and a single project's detail and settings.
 *
 * `listProjects` was authored against `resolveAccessibleProjects`, not lifted
 * from the pre-v1 handler: that one listed every project in the acting org with
 * no `canView` filter and had no UI caller, so it carried no evidence of being
 * correct. The rest are lifted, logic intact, with reads moved onto `req.deps`.
 */

import { randomUUID } from 'node:crypto';
import {
	apiError,
	ApiErrorCode,
	collection,
	created,
	noContent,
	parseBody,
	parseListOptions,
	requireCaller,
	requireParams,
	CreateProjectBodySchema,
	UpdateProjectBodySchema,
	type ApiHandler
} from '../api/index.js';
import {
	canChangeVisibilityToPublic,
	canEdit,
	canSolve,
	canView,
	hasPermission,
	slugify,
	SYSTEM_CONTEXT,
	validateProjectFlags,
	withAdminBypass,
	type ProjectVisibility
} from '@selvajs/platform';
import { resolveAccessibleProjects } from '../definitions/index.js';
import {
	projectAccessInputFromRowsWith,
	requireCanCreateProject,
	requireCanEditProjectSettings,
	requireCanManage
} from '../access/index.js';
import { createProjectWithUniqueSlug } from '../projects/index.js';

export const listProjects: ApiHandler = async (req) => {
	const { ctx } = requireCaller(req);

	const { projects } = await resolveAccessibleProjects(ctx, req.deps);
	const { limit, cursor } = parseListOptions(req.url);
	// The accessible set is resolved in-process rather than by the store, so the
	// cursor is an index into it. Opaque to callers either way.
	const start = cursor ? Number(cursor) : 0;
	if (!Number.isInteger(start) || start < 0) {
		apiError(400, ApiErrorCode.VALIDATION_FAILED, 'Invalid cursor');
	}

	const items = projects.slice(start, start + (limit ?? projects.length));
	const nextIndex = start + items.length;
	return collection({
		items,
		nextCursor: nextIndex < projects.length ? String(nextIndex) : undefined
	});
};

export const createProject: ApiHandler = async (req) => {
	const { ctx, user } = requireCaller(req);
	if (!ctx.actingOrgId) apiError(400, ApiErrorCode.VALIDATION_FAILED, 'No active organization');
	// Throws SvelteKit's `error()`; the host binding folds that into the
	// envelope. Guards stay shared with the page loads that need them.
	await requireCanCreateProject(req, ctx.actingOrgId);

	const input = await parseBody(req.request, CreateProjectBodySchema);

	// Same gate as PATCH: a `platform` project belongs to no org, so creating
	// one here would put it beyond its own org's reach — and beyond anyone's
	// with ENABLE_PLATFORM_PROJECTS off. Platform projects are created
	// through /api/admin/projects.
	if (input.visibility === 'platform' && !hasPermission(ctx, 'instance_admin')) {
		apiError(
			403,
			ApiErrorCode.FORBIDDEN,
			'Only a platform admin can create a project with platform visibility.'
		);
	}

	const autoJoinOnUpload = input.autoJoinOnUpload ?? false;
	// Same call PATCH makes, rather than a second hand-rolled copy of the
	// flag/visibility invariant.
	const flagIssues = validateProjectFlags({ visibility: input.visibility, autoJoinOnUpload });
	if (flagIssues.length > 0) {
		apiError(
			400,
			ApiErrorCode.VALIDATION_FAILED,
			flagIssues.map((i) => `${i.path}: ${i.message}`).join('; ')
		);
	}

	const project = await createProjectWithUniqueSlug(
		req.deps.projects,
		{
			id: randomUUID(),
			orgId: ctx.actingOrgId,
			name: input.name,
			description: input.description,
			visibility: input.visibility,
			ownerId: user.id,
			createdBy: user.id,
			updatedBy: user.id,
			autoJoinOnUpload
		},
		{ writeCtx: ctx, fallbackSlug: 'project', conflictScope: 'this organization' }
	);
	return created(project);
};

/**
 * Project detail plus the caller's effective capabilities on it.
 *
 * A project the caller cannot view returns 404, not 403 — `403` would confirm
 * the id exists to anyone probing.
 */
export const getProject: ApiHandler = async (req) => {
	const { id } = requireParams(req.params, 'id');
	const { ctx } = requireCaller(req);

	// Read as SYSTEM to decide visibility here rather than let the store decide:
	// the 404-not-403 rule above needs the row before it can hide it.
	const project = await req.deps.projects.getProject(SYSTEM_CONTEXT, id);
	if (!project) apiError(404, ApiErrorCode.NOT_FOUND, 'Project not found');

	const [orgMembers, projectMembers, grants] = await Promise.all([
		req.deps.orgs.getOrgMembersFor(SYSTEM_CONTEXT, [project.orgId], ctx.userId),
		req.deps.projects.getProjectMembersFor(SYSTEM_CONTEXT, [project.id], ctx.userId),
		project.visibility === 'platform'
			? req.deps.platformProjectGrants.listByProject(SYSTEM_CONTEXT, project.id)
			: Promise.resolve([])
	]);

	const member = projectMembers.get(project.id) ?? null;
	const input = projectAccessInputFromRowsWith(req, ctx, project, {
		member,
		orgMember: orgMembers.get(project.orgId) ?? null,
		platformGrants: grants
	});
	if (!canView(input)) apiError(404, ApiErrorCode.NOT_FOUND, 'Project not found');

	return {
		body: {
			...project,
			role: member?.role ?? null,
			canEdit: canEdit(input),
			canSolve: canSolve(input)
		}
	};
};

export const updateProject: ApiHandler = async (req) => {
	const { id } = requireParams(req.params, 'id');

	// `requireCanEditProjectSettings` is owner-only at the project level — that
	// IS the gate for editing settings. The platform-scope `manage_projects`
	// check that used to live here was redundant for org owners/admins (they
	// always carry it via DEFAULT_ORG_PERMISSIONS) and a regression for plain
	// org members who happened to own a project — they'd hit 403 on their own
	// project's settings.
	const { ctx, project: existing } = await requireCanEditProjectSettings(req, id);

	const input = await parseBody(req.request, UpdateProjectBodySchema);

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
		const orgMember = await req.deps.orgs.getOrgMember(ctx, existing.orgId, ctx.userId);
		const passes = withAdminBypass(ctx.platformPermissions, () =>
			canChangeVisibilityToPublic({ orgMember })
		);
		if (!passes) {
			apiError(403, ApiErrorCode.FORBIDDEN, 'Only org owners or admins can make a project public.');
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

	await req.deps.projects.updateProject(ctx, id, patch);
	return noContent();
};

export const deleteProject: ApiHandler = async (req) => {
	const { id } = requireParams(req.params, 'id');
	const { ctx } = requireCaller(req);
	await requireCanManage(req, id);

	await req.deps.projects.deleteProject(ctx, id);
	return noContent();
};
