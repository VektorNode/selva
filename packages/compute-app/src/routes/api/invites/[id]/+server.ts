import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getInviteStore } from '$lib/server/providers.server';
import { requireManageUsers } from '$lib/server/access.server';
import { handleApiError } from '$lib/server/api-errors';

// DELETE — revoke a pending invite. Consumed invites are preserved for audit.
export const DELETE: RequestHandler = async ({ params, locals }) => {
	requireManageUsers(locals);
	const ctx = locals.ctx!;
	try {
		await getInviteStore().revoke(ctx, params.id!);
		return json({ success: true });
	} catch (err) {
		handleApiError(err, 'Failed to revoke invite');
	}
};
