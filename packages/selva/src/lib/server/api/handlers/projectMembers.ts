/**
 * Project membership: list, add, change role, remove.
 *
 * Every method here gates on `requireCanManage(req, id, 'members')`. The
 * owner-count preconditions on PATCH and DELETE come from `checkOwnerRemoval`,
 * a pure rules function, so demotion and removal cannot drift apart — a sole
 * owner demoting themselves locks the project exactly as removing themselves
 * would.
 */

import {
	apiError,
	ApiErrorCode,
	collection,
	created,
	noContent,
	parseBody,
	requireParams
} from '@selvajs/server/api';
import type { ApiHandler, ApiRequest } from '@selvajs/server/api';
import { checkOwnerRemoval, type ProjectMember, type ProjectRole } from '@selvajs/platform';
import { requireCanManage, requireTargetIsOrgMember } from '../../access.server';
import { parseListOptions } from '../../pagination.server';
import { AddProjectMemberBodySchema, UpdateProjectMemberBodySchema } from '../v1/bodies';
import { requireCaller } from '../callers';

export const listProjectMembers: ApiHandler = async (req) => {
	const { id } = requireParams(req.params, 'id');
	const { ctx } = requireCaller(req);
	await requireCanManage(req, id, 'members');

	return collection(await req.deps.projects.listProjectMembers(ctx, id, parseListOptions(req.url)));
};

export const addProjectMember: ApiHandler = async (req) => {
	const { id } = requireParams(req.params, 'id');
	const { ctx } = requireCaller(req);
	await requireCanManage(req, id, 'members');

	const input = await parseBody(req.request, AddProjectMemberBodySchema);

	const project = await req.deps.projects.getProject(ctx, id);
	if (!project) apiError(404, ApiErrorCode.NOT_FOUND, 'Project not found');
	await requireTargetIsOrgMember(req, project.orgId, input.userId);

	const now = new Date().toISOString();
	const member: ProjectMember = {
		projectId: id,
		userId: input.userId,
		role: input.role,
		joinedAt: now,
		updatedAt: now,
		updatedBy: ctx.userId || input.userId,
		deletedAt: null
	};

	await req.deps.projects.addProjectMember(ctx, member);
	return created(member);
};

/**
 * Guard the owner count before a demotion or removal goes through.
 *
 * `?confirm=true` is what distinguishes "I meant to do this" from a misclick;
 * the sole-owner case has no confirmation, because there is no state the
 * caller could confirm into that leaves the project manageable.
 */
async function assertOwnerRemovable(
	req: ApiRequest,
	projectId: string,
	target: { role: ProjectRole },
	action: 'demote' | 'remove'
): Promise<void> {
	const { ctx } = requireCaller(req);
	const page = await req.deps.projects.listProjectMembers(ctx, projectId, { limit: 200 });
	const decision = checkOwnerRemoval({
		target: { role: target.role },
		allMembers: page.items.map((m) => ({ role: m.role })),
		confirmed: req.url.searchParams.get('confirm') === 'true'
	});

	if (decision === 'sole_owner') {
		apiError(
			409,
			ApiErrorCode.CONFLICT,
			`Cannot ${action} the sole owner of a project. Assign another owner first, or use reclaim to add a co-owner.`
		);
	}
	if (decision === 'needs_confirm') {
		apiError(
			409,
			ApiErrorCode.CONFLICT,
			`${action === 'demote' ? 'Demoting' : 'Removing'} another project owner requires explicit confirmation. Retry with ?confirm=true.`
		);
	}
}

export const updateProjectMemberRole: ApiHandler = async (req) => {
	const { id, userId } = requireParams(req.params, 'id', 'userId');
	const { ctx } = requireCaller(req);
	await requireCanManage(req, id, 'members');
	const { role } = await parseBody(req.request, UpdateProjectMemberBodySchema);

	// Demoting an owner reduces the owner count exactly like removing one, so
	// it runs the same guard DELETE does. Without this a sole owner can PATCH
	// themselves to `viewer` and lock the project — `canManage`,
	// `canEditProjectSettings` and `canEdit` all go false at once.
	if (role !== 'owner') {
		const target = await req.deps.projects.getProjectMember(ctx, id, userId);
		if (target?.role === 'owner') {
			await assertOwnerRemovable(req, id, target, 'demote');
		}
	}

	await req.deps.projects.updateProjectMemberRole(ctx, id, userId, role);
	return noContent();
};

export const removeProjectMember: ApiHandler = async (req) => {
	const { id, userId } = requireParams(req.params, 'id', 'userId');
	const { ctx } = requireCaller(req);
	await requireCanManage(req, id, 'members');

	const target = await req.deps.projects.getProjectMember(ctx, id, userId);
	// Idempotent: already gone, or never there.
	if (!target) return noContent();

	if (target.role === 'owner') {
		await assertOwnerRemovable(req, id, target, 'remove');
	}

	await req.deps.projects.removeProjectMember(ctx, id, userId);
	return noContent();
};
