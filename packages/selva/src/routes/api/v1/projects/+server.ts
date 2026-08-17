import type { RequestHandler } from './$types';
import { randomUUID } from 'node:crypto';
import { getProjectProvider } from '$lib/server/providers.server';
import { requireCanCreateProject } from '$lib/server/access.server';
import { apiError, ApiErrorCode } from '$lib/server/api-errors';
import { slugify, hasPermission } from '@selvajs/platform';
import { ProviderError, type Project } from '@selvajs/platform';
import { resolveAccessibleProjects } from '$lib/server/definitions/visibility.server';
import { parseListOptions } from '$lib/server/pagination.server';
import { CreateProjectBodySchema } from '$lib/server/api/v1/bodies';
import { apiRoute, collection, created, parseBody, requireCaller } from '$lib/server/api/v1/route';

const MAX_SLUG_ATTEMPTS = 25;

function isSlugConflict(err: unknown): boolean {
	return (
		err instanceof ProviderError &&
		err.statusCode === 409 &&
		/projects_org_id_slug_key/.test(err.message)
	);
}

function isNameConflict(err: unknown): boolean {
	return (
		err instanceof ProviderError &&
		err.statusCode === 409 &&
		/projects_org_name_unique/.test(err.message)
	);
}

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
		if (autoJoinOnUpload && input.visibility !== 'public') {
			apiError(400, ApiErrorCode.VALIDATION_FAILED, 'autoJoinOnUpload requires visibility=public');
		}

		const projectStore = getProjectProvider();
		const baseSlug = slugify(input.name) || 'project';
		const now = new Date().toISOString();
		const projectId = randomUUID();

		// Retry on slug collision: the caller may not be able to *see* a colliding
		// project under RLS, so a pre-flight getProjectBySlug isn't enough — the
		// unique index is the source of truth.
		for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt++) {
			const project: Project = {
				id: projectId,
				orgId: ctx.actingOrgId,
				name: input.name,
				slug: attempt === 0 ? baseSlug : `${baseSlug}-${attempt + 1}`,
				description: input.description,
				visibility: input.visibility,
				ownerId: locals.user!.id,
				createdBy: locals.user!.id,
				updatedBy: locals.user!.id,
				autoJoinOnUpload,
				createdAt: now,
				updatedAt: now,
				deletedAt: null
			};

			try {
				await projectStore.createProject(ctx, project);
				return created(project);
			} catch (err) {
				if (isNameConflict(err)) {
					apiError(
						409,
						ApiErrorCode.CONFLICT,
						'A project with that name already exists in this organization.'
					);
				}
				// A slug clash is the one error worth another attempt; everything else
				// leaves the loop for the wrapper to map.
				if (!isSlugConflict(err)) throw err;
			}
		}

		apiError(
			409,
			ApiErrorCode.CONFLICT,
			'Could not pick a unique project slug after several attempts.'
		);
	}
);
