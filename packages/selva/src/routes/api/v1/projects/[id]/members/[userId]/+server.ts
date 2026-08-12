import type { RequestHandler } from './$types';
import { getProjectProvider } from '$lib/server/providers.server';
import { requireCanManageMembers } from '$lib/server/access.server';
import { apiError, ApiErrorCode } from '$lib/server/api-errors';
import { checkOwnerRemoval } from '@selvajs/platform';
import { UpdateProjectMemberBodySchema } from '$lib/server/api/v1/bodies';
import { apiRoute, noContent, parseBody, requireParams } from '$lib/server/api/v1/route';

export const PATCH: RequestHandler = apiRoute(
	'Failed to update role',
	async ({ params, request, locals }) => {
		const { id, userId } = requireParams(params, 'id', 'userId');
		await requireCanManageMembers(locals, id);
		const { role } = await parseBody(request, UpdateProjectMemberBodySchema);

		await getProjectProvider().updateProjectMemberRole(locals.ctx!, id, userId, role);
		return noContent();
	}
);

export const DELETE: RequestHandler = apiRoute(
	'Failed to remove member',
	async ({ params, url, locals }) => {
		const { id, userId } = requireParams(params, 'id', 'userId');
		await requireCanManageMembers(locals, id);
		const ctx = locals.ctx!;

		const projects = getProjectProvider();
		const target = await projects.getProjectMember(ctx, id, userId);
		// Idempotent: already gone, or never there.
		if (!target) return noContent();

		// Owner-removal preconditions come from a pure rules function, so the
		// behaviour is identical across providers and unit-tested in isolation.
		if (target.role === 'owner') {
			const page = await projects.listProjectMembers(ctx, id, { limit: 200 });
			const decision = checkOwnerRemoval({
				target: { role: target.role },
				allMembers: page.items.map((m) => ({ role: m.role })),
				confirmed: url.searchParams.get('confirm') === 'true'
			});
			if (decision === 'sole_owner') {
				apiError(
					409,
					ApiErrorCode.CONFLICT,
					'Cannot remove the sole owner of a project. Assign another owner first, or use reclaim to add a co-owner.'
				);
			}
			if (decision === 'needs_confirm') {
				apiError(
					409,
					ApiErrorCode.CONFLICT,
					'Removing another project owner requires explicit confirmation. Retry with ?confirm=true.'
				);
			}
		}

		await projects.removeProjectMember(ctx, id, userId);
		return noContent();
	}
);
