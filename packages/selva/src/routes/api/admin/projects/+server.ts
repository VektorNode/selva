import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { flag, getProjectProvider, getOrganizationProvider } from '$lib/server/providers.server';
import { requireInstanceAdmin } from '$lib/server/access.server';
import { apiError, ApiErrorCode } from '$lib/server/api-errors';
import { apiRoute, created, parseBody } from '$lib/server/api/http';
import { createProjectWithUniqueSlug } from '@selvajs/server/projects';
import { SYSTEM_CONTEXT, type Project } from '@selvajs/platform';

const CreatePlatformProjectBody = z.object({
	name: z.string().min(1, 'Project name is required').max(128).trim(),
	description: z.string().max(2000).optional(),
	/**
	 * Org that physically hosts the project. Storage routing and compute
	 * resolution use this — but org membership in this org does NOT grant
	 * access. Visibility = 'platform' overrides those defaults.
	 *
	 * If omitted, the platform admin's first available org is used.
	 */
	orgId: z.string().uuid().optional()
});

/**
 * §4a — list every platform-visibility project on the instance. Uses
 * `SYSTEM_CONTEXT` because admin reads cross every org boundary; the route is
 * gated on `instance_admin`.
 */
export const GET: RequestHandler = apiRoute(
	'Failed to list platform projects',
	async ({ locals }) => {
		requireInstanceAdmin(locals);
		if (!flag('ENABLE_PLATFORM_PROJECTS')) apiError(404, ApiErrorCode.NOT_FOUND, 'Not found');

		// Listing across orgs requires walking each org. Fast enough for the
		// admin surface; if instance scale ever demands it, add a dedicated
		// `listPlatform()` to IProjectStore.
		const orgs = await getOrganizationProvider().listOrgs(SYSTEM_CONTEXT, { limit: 1000 });
		const all: Project[] = [];
		for (const org of orgs.items) {
			const page = await getProjectProvider().listProjects(SYSTEM_CONTEXT, org.id, {
				limit: 1000
			});
			for (const p of page.items) {
				if (p.visibility === 'platform') all.push(p);
			}
		}
		return json({ projects: all });
	}
);

export const POST: RequestHandler = apiRoute(
	'Failed to create platform project',
	async ({ request, locals }) => {
		const user = requireInstanceAdmin(locals);
		if (!flag('ENABLE_PLATFORM_PROJECTS')) apiError(404, ApiErrorCode.NOT_FOUND, 'Not found');

		const input = await parseBody(request, CreatePlatformProjectBody);

		// Resolve the host org. Admin's `actingOrgId` is the natural default; if
		// they pass an explicit `orgId`, validate it exists.
		const hostOrgId = input.orgId ?? locals.ctx!.actingOrgId;
		if (!hostOrgId) {
			apiError(
				400,
				ApiErrorCode.VALIDATION_FAILED,
				'A host orgId is required (no active organization in context).'
			);
		}
		const hostOrg = await getOrganizationProvider().getOrg(SYSTEM_CONTEXT, hostOrgId);
		if (!hostOrg)
			apiError(400, ApiErrorCode.VALIDATION_FAILED, `Host organization '${hostOrgId}' not found.`);

		// `autoJoinOnUpload: false` is hardcoded, which is what makes skipping
		// `validateProjectFlags` safe here — a platform project may not carry the
		// flag at all. If this ever takes the flag from the body, validate it.
		const project = await createProjectWithUniqueSlug(
			getProjectProvider(),
			{
				id: randomUUID(),
				orgId: hostOrgId,
				name: input.name,
				description: input.description,
				visibility: 'platform',
				ownerId: user.id,
				createdBy: user.id,
				updatedBy: user.id,
				autoJoinOnUpload: false
			},
			{
				writeCtx: SYSTEM_CONTEXT,
				fallbackSlug: 'platform-project',
				conflictScope: 'the host organization'
			}
		);
		return created(project);
	}
);
