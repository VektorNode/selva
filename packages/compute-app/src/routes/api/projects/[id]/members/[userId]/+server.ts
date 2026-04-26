import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getProjectProvider } from '$lib/server/providers.server';
import { requireCanManageMembers } from '$lib/server/access.server';
import { handleApiError, throwZodError } from '$lib/server/api-errors';
import { ProjectRoleSchema, checkOwnerRemoval } from '@selvajs/platform';

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

export const DELETE: RequestHandler = async ({ params, url, locals }) => {
	const { id, userId } = params;
	if (!id || !userId) throw error(400, 'Missing project ID or user ID');
	await requireCanManageMembers(locals, id);
	const ctx = locals.ctx!;
	const confirmed = url.searchParams.get('confirm') === 'true';

	const projects = getProjectProvider();
	const target = await projects.getProjectMember(ctx, id, userId);
	if (!target) {
		// Idempotent: already gone (or never existed).
		return json({ success: true });
	}

	// §5/§10 owner-removal preconditions. Pure check from rules.ts so the
	// behavior is the same across providers and is unit-tested in isolation.
	if (target.role === 'owner') {
		const page = await projects.listProjectMembers(ctx, id, { limit: 200 });
		const decision = checkOwnerRemoval({
			target: { role: target.role },
			allMembers: page.items.map((m) => ({ role: m.role })),
			confirmed
		});
		if (decision === 'sole_owner') {
			throw error(
				409,
				'Cannot remove the sole owner of a project. Assign another owner first, or use reclaim to add a co-owner.'
			);
		}
		if (decision === 'needs_confirm') {
			throw error(
				409,
				'Removing another project owner requires explicit confirmation. Retry with ?confirm=true.'
			);
		}
	}

	try {
		await projects.removeProjectMember(ctx, id, userId);
		return json({ success: true });
	} catch (err) {
		handleApiError(err, 'Failed to remove member');
	}
};
