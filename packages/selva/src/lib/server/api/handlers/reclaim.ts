/**
 * Org owner/admin escape hatch for a project they cannot otherwise reach.
 *
 * Adds the actor as a co-owner and does NOT demote the existing owner.
 * Idempotent: reclaiming twice is a no-op, because `addProjectMember`
 * reactivates a soft-deleted row in place.
 */

import { created, requireParams, type ApiHandler } from '@selvajs/server/api';
import { actorFrom, type ProjectMember } from '@selvajs/platform';
import { requireCanReclaim } from '../../access.server';

export const reclaimProject: ApiHandler = async (req) => {
	const { id } = requireParams(req.params, 'id');
	const { user, ctx, project } = await requireCanReclaim(req, id);

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

	await req.deps.projects.addProjectMember(ctx, member);

	// `addProjectMember` emits `project_member.added`, which is byte-identical
	// to an owner adding a teammate. The whole escape hatch rests on the audit
	// trail, so the escalation needs its own event or the log cannot answer the
	// only question an auditor has here.
	await req.deps.events.emit({
		type: 'project.reclaimed',
		projectId: id,
		orgId: project.orgId,
		actorId: actorFrom(ctx),
		priorVisibility: project.visibility
	});

	return created({ member });
};
