import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getProjectProvider } from '$lib/server/providers.server';
import { requireCanReclaim } from '$lib/server/access.server';
import { handleApiError } from '$lib/server/api-errors';
import type { ProjectMember } from '@selvajs/platform';

/**
 * §5 / §7 — org owner/admin escape hatch. Adds the actor as a co-owner; does
 * NOT demote the existing owner. Idempotent: reclaiming twice is a no-op
 * because `addProjectMember` reactivates a soft-deleted row in place.
 */
export const POST: RequestHandler = async ({ params, locals }) => {
	const { id } = params;
	if (!id) throw error(400, 'Missing project ID');

	const { user, ctx } = await requireCanReclaim(locals, id);

	const now = new Date().toISOString();
	const member: ProjectMember = {
		projectId: id,
		userId: user.id,
		role: 'owner',
		joinedAt: now,
		updatedAt: now,
		updatedBy: ctx.userId || user.id,
		deletedAt: null
	};

	try {
		await getProjectProvider().addProjectMember(ctx, member);
		return json({ success: true, member });
	} catch (err) {
		handleApiError(err, 'Failed to reclaim project');
	}
};
