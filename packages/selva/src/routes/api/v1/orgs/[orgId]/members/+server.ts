import type { RequestHandler } from './$types';
import { getOrganizationProvider } from '$lib/server/providers.server';
import { requireActingOrg } from '$lib/server/access.server';
import { parseListOptions } from '$lib/server/pagination.server';
import { apiRoute, collection } from '$lib/server/api/v1/route';

/**
 * List the org's members. Any member of the acting org may read this — the
 * roster is what the team page renders, and `requireActingOrg` already confines
 * the read to the caller's own tenant.
 */
export const GET: RequestHandler = apiRoute(
	'Failed to list organization members',
	async ({ params, locals, url }) => {
		const { ctx, orgId } = requireActingOrg(locals, params.orgId);

		return collection(
			await getOrganizationProvider().listOrgMembers(ctx, orgId, parseListOptions(url))
		);
	}
);
