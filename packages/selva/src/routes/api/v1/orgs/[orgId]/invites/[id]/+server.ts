import type { RequestHandler } from './$types';
import { getInviteStore } from '$lib/server/providers.server';
import { requireManageOrgMembers, requireActingOrg } from '$lib/server/access.server';
import { apiError, ApiErrorCode } from '$lib/server/api-errors';
import { apiRoute, noContent, requireParams } from '$lib/server/api/v1/route';

/** Revoke a pending invite. Consumed invites are preserved for audit. */
export const DELETE: RequestHandler = apiRoute(
	'Failed to revoke invite',
	async ({ params, locals }) => {
		requireManageOrgMembers(locals);
		const { ctx, orgId } = requireActingOrg(locals, params.orgId);
		const { id } = requireParams(params, 'id');

		// `manage_org_members` is org-scoped, so a permitted caller must not reach
		// invites in another org. Neither store scopes revoke() by actingOrgId, so
		// confirm the invite belongs to this org before revoking it.
		const store = getInviteStore();
		let cursor: string | undefined;
		let found = false;
		do {
			const page = await store.listByOrg(ctx, orgId, { limit: 200, cursor });
			if (page.items.some((i) => i.id === id)) {
				found = true;
				break;
			}
			cursor = page.nextCursor ?? undefined;
		} while (cursor);

		if (!found) apiError(404, ApiErrorCode.NOT_FOUND, 'Invite not found');
		await store.revoke(ctx, id);
		return noContent();
	}
);
