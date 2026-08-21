/**
 * Projects the caller can view.
 *
 * Authored against `resolveAccessibleProjects`, not lifted from the pre-v1
 * handler: that one listed every project in the acting org with no `canView`
 * filter and had no UI caller, so it carried no evidence of being correct.
 */

import { randomUUID } from 'node:crypto';
import { apiError, ApiErrorCode, collection, created, type ApiHandler } from '@selvajs/server/api';
import { hasPermission, validateProjectFlags } from '@selvajs/platform';
import { resolveAccessibleProjects } from '../../definitions/visibility.server';
import { parseListOptions } from '../../pagination.server';
import { requireCanCreateProject } from '../../access.server';
import { createProjectWithUniqueSlug } from '../../projects/createProject.server';
import { CreateProjectBodySchema } from '../v1/bodies';
import { parseBody } from '../v1/route';
import { requireCaller } from '../callers';

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
