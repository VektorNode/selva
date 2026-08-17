import type { RequestHandler } from './$types';
import { getProjectProvider } from '$lib/server/providers.server';
import { requireCanManage, requireTargetIsOrgMember } from '$lib/server/access.server';
import { apiError, ApiErrorCode } from '$lib/server/api-errors';
import type { ProjectMember } from '@selvajs/platform';
import { AddProjectMemberBodySchema } from '$lib/server/api/v1/bodies';
import { parseListOptions } from '$lib/server/pagination.server';
import { apiRoute, collection, created, parseBody, requireParams } from '$lib/server/api/v1/route';

export const GET: RequestHandler = apiRoute(
	'Failed to load members',
	async ({ params, locals, url }) => {
		const { id } = requireParams(params, 'id');
		await requireCanManage(locals, id, 'members');

		return collection(
			await getProjectProvider().listProjectMembers(locals.ctx!, id, parseListOptions(url))
		);
	}
);

export const POST: RequestHandler = apiRoute(
	'Failed to add member',
	async ({ params, request, locals }) => {
		const { id } = requireParams(params, 'id');
		await requireCanManage(locals, id, 'members');
		const ctx = locals.ctx!;

		const input = await parseBody(request, AddProjectMemberBodySchema);

		const project = await getProjectProvider().getProject(ctx, id);
		if (!project) apiError(404, ApiErrorCode.NOT_FOUND, 'Project not found');
		await requireTargetIsOrgMember(locals, project.orgId, input.userId);

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

		await getProjectProvider().addProjectMember(ctx, member);
		return created(member);
	}
);
