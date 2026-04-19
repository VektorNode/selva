import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getOrganizationProvider } from '$lib/server/providers.server';
import { throwProviderError } from '$lib/server/access.server';
import { SYSTEM_CONTEXT } from '@selva/platform';
import type { ProjectRole } from '@selva/platform';

const VALID_ROLES: ProjectRole[] = ['owner', 'editor', 'viewer'];

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const { id, userId } = params;
	if (!id || !userId) throw error(400, 'Missing project ID or user ID');
	const ctx = locals.ctx ?? SYSTEM_CONTEXT;

	const body = await request.json().catch(() => null);
	const { role } = (body ?? {}) as Record<string, unknown>;
	if (!role || !VALID_ROLES.includes(role as ProjectRole)) {
		throw error(400, `role must be one of: ${VALID_ROLES.join(', ')}`);
	}

	try {
		await getOrganizationProvider().updateProjectMemberRole(ctx, id, userId, role as ProjectRole);
		return json({ success: true });
	} catch (err) {
		throwProviderError(err, 'Failed to update role');
	}
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	const { id, userId } = params;
	if (!id || !userId) throw error(400, 'Missing project ID or user ID');
	const ctx = locals.ctx ?? SYSTEM_CONTEXT;

	try {
		await getOrganizationProvider().removeProjectMember(ctx, id, userId);
		return json({ success: true });
	} catch (err) {
		throwProviderError(err, 'Failed to remove member');
	}
};
