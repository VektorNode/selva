import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import {
	getProjectProvider,
	getPlatformProjectGrantStore,
	getOrganizationProvider,
	getUserProfileStore
} from '$lib/server/providers.server';
import { requireInstanceAdmin } from '$lib/server/access.server';
import { handleApiError, throwZodError } from '$lib/server/api-errors';
import { SYSTEM_CONTEXT, type PlatformProjectGrant } from '@selvajs/platform';

const CreateGrantBody = z.object({
	granteeType: z.enum(['org', 'user']),
	granteeId: z.string().min(1),
	canSolve: z.boolean()
});

async function assertPlatformProject(id: string) {
	const project = await getProjectProvider().getProject(SYSTEM_CONTEXT, id);
	if (!project || project.visibility !== 'platform') {
		throw error(404, 'Platform project not found');
	}
	return project;
}

export const GET: RequestHandler = async ({ params, locals }) => {
	requireInstanceAdmin(locals);
	const { id } = params;
	if (!id) throw error(400, 'Missing project ID');
	try {
		await assertPlatformProject(id);
		const grants = await getPlatformProjectGrantStore().listByProject(SYSTEM_CONTEXT, id);
		return json({ grants });
	} catch (err) {
		handleApiError(err, 'Failed to list grants');
	}
};

export const POST: RequestHandler = async ({ params, request, locals }) => {
	const user = requireInstanceAdmin(locals);
	const { id } = params;
	if (!id) throw error(400, 'Missing project ID');

	const body = await request.json().catch(() => null);
	const parsed = CreateGrantBody.safeParse(body);
	if (!parsed.success) throwZodError(parsed.error);

	try {
		await assertPlatformProject(id);

		// Validate the grantee actually exists. Local provider has no FK so we
		// catch typos here; Supabase will eventually enforce via DB FK.
		if (parsed.data.granteeType === 'org') {
			const org = await getOrganizationProvider().getOrg(SYSTEM_CONTEXT, parsed.data.granteeId);
			if (!org) throw error(400, `Organization '${parsed.data.granteeId}' not found`);
		} else {
			const profile = await getUserProfileStore().getProfile(
				SYSTEM_CONTEXT,
				parsed.data.granteeId
			);
			if (!profile) throw error(400, `User '${parsed.data.granteeId}' not found`);
		}

		const grant: PlatformProjectGrant = {
			id: randomUUID(),
			projectId: id,
			granteeType: parsed.data.granteeType,
			granteeId: parsed.data.granteeId,
			canSolve: parsed.data.canSolve,
			createdBy: user.id,
			createdAt: new Date().toISOString()
		};

		await getPlatformProjectGrantStore().create(SYSTEM_CONTEXT, grant);
		return json(grant, { status: 201 });
	} catch (err) {
		handleApiError(err, 'Failed to create grant');
	}
};
