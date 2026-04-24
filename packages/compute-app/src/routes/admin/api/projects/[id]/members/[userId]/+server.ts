import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getProjectProvider } from '$lib/server/providers.server';
import { requireCanManageMembers } from '$lib/server/access.server';
import { handleApiError, throwZodError } from '$lib/server/api-errors';
import { ProjectRoleSchema } from '@selva/platform';

const UpdateRoleSchema = z.object({ role: ProjectRoleSchema });

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const { id, userId } = params;
	if (!id || !userId) throw error(400, 'Missing project ID or user ID');
	await requireCanManageMembers(locals, id);
	const ctx = locals.ctx!;

	const body = await request.json().catch(() => null);
	const parsed = UpdateRoleSchema.safeParse(body);
	if (!parsed.success) throwZodError(parsed.error);

	try {
		await getProjectProvider().updateProjectMemberRole(ctx, id, userId, parsed.data.role);
		return json({ success: true });
	} catch (err) {
		handleApiError(err, 'Failed to update role');
	}
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	const { id, userId } = params;
	if (!id || !userId) throw error(400, 'Missing project ID or user ID');
	await requireCanManageMembers(locals, id);
	const ctx = locals.ctx!;

	try {
		await getProjectProvider().removeProjectMember(ctx, id, userId);
		return json({ success: true });
	} catch (err) {
		handleApiError(err, 'Failed to remove member');
	}
};
