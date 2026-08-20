import type { RequestHandler } from './$types';
import { randomUUID } from 'node:crypto';
import { getProjectProvider } from '$lib/server/providers.server';
import { requireCanCreateProject } from '$lib/server/access.server';
import { apiError, ApiErrorCode } from '$lib/server/api-errors';
import { hasPermission, validateProjectFlags } from '@selvajs/platform';
import { resolveAccessibleProjects } from '$lib/server/definitions/visibility.server';
import { createProjectWithUniqueSlug } from '$lib/server/projects/createProject.server';
import { parseListOptions } from '$lib/server/pagination.server';
import { CreateProjectBodySchema } from '$lib/server/api/v1/bodies';
import { apiRoute, collection, created, parseBody, requireCaller } from '$lib/server/api/v1/route';

// GET — projects the caller can view.
//
// Authored against `resolveAccessibleProjects`, not lifted from the pre-v1
// handler: that one listed every project in the acting org with no `canView`
// filter and had no UI caller, so it carried no evidence of being correct.
export const GET: RequestHandler = apiRoute('Failed to list projects', async ({ locals, url }) => {
	const { ctx } = requireCaller(locals);

	const { projects } = await resolveAccessibleProjects(ctx);
	const { limit, cursor } = parseListOptions(url);
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
});

export const POST: RequestHandler = apiRoute(
	'Failed to create project',
	async ({ request, locals }) => {
		const ctx = locals.ctx!;
		if (!ctx.actingOrgId) apiError(400, ApiErrorCode.VALIDATION_FAILED, 'No active organization');
		await requireCanCreateProject(locals, ctx.actingOrgId);

		const input = await parseBody(request, CreateProjectBodySchema);

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
		const flagIssues = validateProjectFlags({
			visibility: input.visibility,
			autoJoinOnUpload
		});
		if (flagIssues.length > 0) {
			apiError(
				400,
				ApiErrorCode.VALIDATION_FAILED,
				flagIssues.map((i) => `${i.path}: ${i.message}`).join('; ')
			);
		}

		const project = await createProjectWithUniqueSlug(
			getProjectProvider(),
			{
				id: randomUUID(),
				orgId: ctx.actingOrgId,
				name: input.name,
				description: input.description,
				visibility: input.visibility,
				ownerId: locals.user!.id,
				createdBy: locals.user!.id,
				updatedBy: locals.user!.id,
				autoJoinOnUpload
			},
			{ writeCtx: ctx, fallbackSlug: 'project', conflictScope: 'this organization' }
		);
		return created(project);
	}
);
