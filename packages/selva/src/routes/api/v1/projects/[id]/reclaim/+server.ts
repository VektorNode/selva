import type { RequestHandler } from './$types';
import { getProjectProvider } from '$lib/server/providers.server';
import { requireCanReclaim } from '$lib/server/access.server';
import type { ProjectMember } from '@selvajs/platform';
import { apiRoute, created, requireParams } from '$lib/server/api/v1/route';

/**
 * Org owner/admin escape hatch. Adds the actor as a co-owner and does NOT
 * demote the existing owner. Idempotent: reclaiming twice is a no-op, because
 * `addProjectMember` reactivates a soft-deleted row in place.
 */
export const POST: RequestHandler = apiRoute(
	'Failed to reclaim project',
	async ({ params, locals }) => {
		const { id } = requireParams(params, 'id');
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

		await getProjectProvider().addProjectMember(ctx, member);
		return created({ member });
	}
);
