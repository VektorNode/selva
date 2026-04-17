import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getOrganizationProvider } from '$lib/server/providers.server';
import type { ProjectMember, ProjectRole } from '@selva/platform/organizations';

const VALID_ROLES: ProjectRole[] = ['owner', 'editor', 'viewer'];

export const GET: RequestHandler = async ({ params }) => {
	const { id } = params;
	if (!id) throw error(400, 'Missing project ID');

	try {
		const members = await getOrganizationProvider().listProjectMembers(id);
		return json({ members });
	} catch (err) {
		console.error('[Project members GET] Failed:', err);
		throw error(500, 'Failed to load members');
	}
};

export const POST: RequestHandler = async ({ params, request }) => {
	const { id } = params;
	if (!id) throw error(400, 'Missing project ID');

	const body = await request.json().catch(() => null);
	if (!body || typeof body !== 'object') throw error(400, 'Invalid request body');

	const { userId, role } = body as Record<string, unknown>;
	if (!userId || typeof userId !== 'string') throw error(400, 'userId is required');
	if (!role || !VALID_ROLES.includes(role as ProjectRole)) {
		throw error(400, `role must be one of: ${VALID_ROLES.join(', ')}`);
	}

	const member: ProjectMember = {
		projectId: id,
		userId: userId as string,
		role: role as ProjectRole,
		joinedAt: new Date().toISOString()
	};

	try {
		await getOrganizationProvider().addProjectMember(member);
		return json(member, { status: 201 });
	} catch (err) {
		console.error('[Project members POST] Failed:', err);
		throw error(500, 'Failed to add member');
	}
};
