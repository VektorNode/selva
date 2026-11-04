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
	defaultProjectCreateLimiter,
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
	canCreateDefinition,
	canEdit,
	canSolve,
	canView,
	slugify,
	SYSTEM_CONTEXT,
	outsideTokenOrg,
	scopeAllows,
	validateProjectFlags,
	type ProjectVisibility
} from '@selvajs/platform';
import { resolveAccessibleProjects } from '../definitions/index.js';
import {
	projectAccessInputFromRowsWith,
	requireCanCreateProject,
	requireCanEditProjectSettings,
	requireProjectVisibilityAllowed,
	requireCanManage
} from '../access/index.js';
import { createProjectWithUniqueSlug, deleteProjectWithBlobs } from '../projects/index.js';

/**
 * Projects the caller can view. `canCreateDefinitions` says whether
 * `POST /definitions` would take this project from this caller: the same rule
 * as the route, and for an API token its `upload` scope there.
 */
export const listProjects: ApiHandler = async (req) => {
	const { ctx } = requireCaller(req);

	const set = await resolveAccessibleProjects(ctx, req.deps);
	const { projects } = set;
	const { limit, cursor } = parseListOptions(req.url);
	// The accessible set is resolved in-process rather than by the store, so the
	// cursor is an index into it. Opaque to callers either way.
	const start = cursor ? Number(cursor) : 0;
	if (!Number.isInteger(start) || start < 0) {
		apiError(400, ApiErrorCode.VALIDATION_FAILED, 'Invalid cursor');
	}

	const items = projects.slice(start, start + (limit ?? projects.length));
	const nextIndex = start + items.length;
	// The create route names its project in the body, so it checks scope org-wide.
	const tokenMayUpload = scopeAllows(ctx, 'upload');
	return collection({
		items: items.map((project) => ({
			...project,
			canCreateDefinitions:
				tokenMayUpload &&
				canCreateDefinition(
					projectAccessInputFromRowsWith(req, ctx, project, {
						member: set.memberByProjectId.get(project.id) ?? null,
						orgMember: set.orgMemberByOrgId.get(project.orgId) ?? null,
						platformGrants: set.grantsByProjectId.get(project.id) ?? []
					})
				)
		})),
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
	await requireProjectVisibilityAllowed(req, ctx, ctx.actingOrgId, input);
	if (ctx.apiScope) {
		// Per owner, not per key: minting more keys mustn't buy more projects.
		const limiter =
			req.deps.projectCreateLimiter === undefined
				? defaultProjectCreateLimiter()
				: req.deps.projectCreateLimiter;
		const verdict = await limiter?.hit(`projects:user:${ctx.userId}`);
		if (verdict && !verdict.allowed) {
			apiError(
				429,
				ApiErrorCode.RATE_LIMITED,
				`Too many projects created with API tokens. Retry in ${verdict.retryAfter ?? 1}s.`,
				undefined,
				{ retryAfter: String(verdict.retryAfter ?? 1) }
			);
		}
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
	if (!project || outsideTokenOrg(ctx, project.orgId)) {
		apiError(404, ApiErrorCode.NOT_FOUND, 'Project not found');
	}

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

	await requireProjectVisibilityAllowed(req, ctx, existing.orgId, input, existing);

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
		// A name with no usable letters yields '', which keeps the current slug.
		const slug = slugify(input.name);
		if (slug) patch.slug = slug;
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

	await deleteProjectWithBlobs(
		{
			projects: req.deps.projects,
			definitions: req.deps.definitionMeta,
			storage: req.deps.storage
		},
		ctx,
		id
	);
	return noContent();
};
