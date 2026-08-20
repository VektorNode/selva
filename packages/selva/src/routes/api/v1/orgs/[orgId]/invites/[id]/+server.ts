import type { RequestHandler } from './$types';
import { getInviteStore } from '$lib/server/providers.server';
import { requireManageOrgMembers, requireActingOrg } from '$lib/server/access.server';
import { apiError, ApiErrorCode } from '$lib/server/api-errors';
import { apiRoute, noContent, requireParams } from '$lib/server/api/v1/route';
import { findPendingInviteInOrg } from '$lib/server/invites/lookup.server';

/** Revoke a pending invite. Consumed invites are preserved for audit. */
export const DELETE: RequestHandler = apiRoute(
	'Failed to revoke invite',
	async ({ params, locals }) => {
		requireManageOrgMembers(locals);
		const { ctx, orgId } = requireActingOrg(locals, params.orgId);
		const { id } = requireParams(params, 'id');

		if (!(await findPendingInviteInOrg(ctx, orgId, id))) {
			apiError(404, ApiErrorCode.NOT_FOUND, 'Invite not found');
		}
		await getInviteStore().revoke(ctx, id);
		return noContent();
	}
);
