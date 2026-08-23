import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import {
	flag,
	getProjectProvider,
	getPlatformProjectGrantStore,
	getOrganizationProvider,
	getUserProfileStore
} from '$lib/server/providers.server';
import { requireInstanceAdmin } from '$lib/server/access.server';
import { apiError, ApiErrorCode } from '$lib/server/api-errors';
import { apiRoute, created, parseBody, requireParams } from '$lib/server/api/http';
import { SYSTEM_CONTEXT, type PlatformProjectGrant } from '@selvajs/platform';

const CreateGrantBody = z.object({
	granteeType: z.enum(['org', 'user']),
	granteeId: z.string().min(1),
	canSolve: z.boolean()
});

async function assertPlatformProject(id: string) {
	if (!flag('ENABLE_PLATFORM_PROJECTS')) apiError(404, ApiErrorCode.NOT_FOUND, 'Not found');
	const project = await getProjectProvider().getProject(SYSTEM_CONTEXT, id);
	if (!project || project.visibility !== 'platform') {
		apiError(404, ApiErrorCode.NOT_FOUND, 'Platform project not found');
	}
	return project;
}

export const GET: RequestHandler = apiRoute('Failed to list grants', async ({ params, locals }) => {
	requireInstanceAdmin(locals);
	const { id } = requireParams(params, 'id');

	await assertPlatformProject(id);
	const grants = await getPlatformProjectGrantStore().listByProject(SYSTEM_CONTEXT, id);
	return json({ grants });
});

export const POST: RequestHandler = apiRoute(
	'Failed to create grant',
	async ({ params, request, locals }) => {
		const user = requireInstanceAdmin(locals);
		const { id } = requireParams(params, 'id');

		const input = await parseBody(request, CreateGrantBody);
		await assertPlatformProject(id);

		// Validate the grantee actually exists. Local provider has no FK so we
		// catch typos here; Supabase will eventually enforce via DB FK.
		if (input.granteeType === 'org') {
			const org = await getOrganizationProvider().getOrg(SYSTEM_CONTEXT, input.granteeId);
			if (!org)
				apiError(
					400,
					ApiErrorCode.VALIDATION_FAILED,
					`Organization '${input.granteeId}' not found`
				);
		} else {
			const profile = await getUserProfileStore().getProfile(SYSTEM_CONTEXT, input.granteeId);
			if (!profile)
				apiError(400, ApiErrorCode.VALIDATION_FAILED, `User '${input.granteeId}' not found`);
		}

		const grant: PlatformProjectGrant = {
			id: randomUUID(),
			projectId: id,
			granteeType: input.granteeType,
			granteeId: input.granteeId,
			canSolve: input.canSolve,
			createdBy: user.id,
			createdAt: new Date().toISOString()
		};

		await getPlatformProjectGrantStore().create(SYSTEM_CONTEXT, grant);
		return created(grant);
	}
);
