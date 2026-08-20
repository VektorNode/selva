import type { RequestHandler } from './$types';
import { getEventSink, getProjectProvider } from '$lib/server/providers.server';
import { requireCanReclaim } from '$lib/server/access.server';
import { actorFrom, type ProjectMember } from '@selvajs/platform';
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
		const { user, ctx, project } = await requireCanReclaim(locals, id);

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

		// `addProjectMember` emits `project_member.added`, which is byte-identical
		// to an owner adding a teammate. §4 rests the whole escape hatch on the
		// audit trail, so the escalation needs its own event or the log cannot
		// answer the only question an auditor has here.
		await getEventSink().emit({
			type: 'project.reclaimed',
			projectId: id,
			orgId: project.orgId,
			actorId: actorFrom(ctx),
			priorVisibility: project.visibility
		});

		return created({ member });
	}
);
