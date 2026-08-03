import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getOrganizationProvider } from '$lib/server/providers.server';
import { requireActingOrg } from '$lib/server/access.server';
import { handleApiError } from '$lib/server/api-errors';
import { parseListOptions } from '$lib/server/pagination.server';

/**
 * List the org's members. Any member of the acting org may read this — the
 * roster is what the team page renders, and `requireActingOrg` already confines
 * the read to the caller's own tenant.
 */
export const GET: RequestHandler = async ({ params, locals, url }) => {
	const { ctx, orgId } = requireActingOrg(locals, params.orgId);

	try {
		const page = await getOrganizationProvider().listOrgMembers(ctx, orgId, parseListOptions(url));
		return json({ items: page.items, nextCursor: page.nextCursor });
	} catch (err) {
		handleApiError(err, 'Failed to list organization members');
	}
};
