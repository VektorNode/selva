import type { RequestHandler } from './$types';
import { getInviteStore } from '$lib/server/providers.server';
import { requireManageOrgMembers, requireActingOrg } from '$lib/server/access.server';
import { handleApiError, apiError, ApiErrorCode } from '$lib/server/api-errors';

// DELETE — revoke a pending invite. Consumed invites are preserved for audit.
export const DELETE: RequestHandler = async ({ params, locals }) => {
	requireManageOrgMembers(locals);
	const { ctx, orgId } = requireActingOrg(locals, params.orgId);
	const id = params.id!;
	try {
		// `manage_org_members` is org-scoped, so a permitted caller must not be
		// able to revoke invites in other orgs. Neither store scopes revoke()
		// by actingOrgId today, so confirm membership of the caller's org first
		// by paginating listByOrg until the id is seen or the cursor runs out.
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
		return new Response(null, { status: 204 });
	} catch (err) {
		handleApiError(err, 'Failed to revoke invite');
	}
};
