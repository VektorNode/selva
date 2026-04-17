import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getOrganizationProvider } from '$lib/server/providers.server';
import type { ProjectRole } from '@selva/platform/organizations';

const VALID_ROLES: ProjectRole[] = ['owner', 'editor', 'viewer'];

export const PATCH: RequestHandler = async ({ params, request }) => {
	const { id, userId } = params;
	if (!id || !userId) throw error(400, 'Missing project ID or user ID');

	const body = await request.json().catch(() => null);
	const { role } = (body ?? {}) as Record<string, unknown>;
	if (!role || !VALID_ROLES.includes(role as ProjectRole)) {
		throw error(400, `role must be one of: ${VALID_ROLES.join(', ')}`);
	}

	try {
		await getOrganizationProvider().updateProjectMemberRole(id, userId, role as ProjectRole);
		return json({ success: true });
	} catch (err) {
		if (err instanceof Error && err.message.includes('not found')) throw error(404, err.message);
		throw error(500, 'Failed to update role');
	}
};

export const DELETE: RequestHandler = async ({ params }) => {
	const { id, userId } = params;
	if (!id || !userId) throw error(400, 'Missing project ID or user ID');

	try {
		await getOrganizationProvider().removeProjectMember(id, userId);
		return json({ success: true });
	} catch (err) {
		if (err instanceof Error && err.message.includes('not found')) throw error(404, err.message);
		throw error(500, 'Failed to remove member');
	}
};
