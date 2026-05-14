import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getInviteStore } from '$lib/server/providers.server';
import { requireManageOrgMembers } from '$lib/server/access.server';
import { handleApiError } from '$lib/server/api-errors';

// DELETE — revoke a pending invite. Consumed invites are preserved for audit.
export const DELETE: RequestHandler = async ({ params, locals }) => {
	requireManageOrgMembers(locals);
	const ctx = locals.ctx!;
	if (!ctx.actingOrgId) throw error(400, 'No active organization');
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
			const page = await store.listByOrg(ctx, ctx.actingOrgId, { limit: 200, cursor });
			if (page.items.some((i) => i.id === id)) {
				found = true;
				break;
			}
			cursor = page.nextCursor ?? undefined;
		} while (cursor);
		if (!found) throw error(404, 'Invite not found');
		await store.revoke(ctx, id);
		return json({ success: true });
	} catch (err) {
		handleApiError(err, 'Failed to revoke invite');
	}
};
