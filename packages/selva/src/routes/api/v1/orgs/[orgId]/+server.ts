import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getOrganizationProvider } from '$lib/server/providers.server';
import { requireActingOrg } from '$lib/server/access.server';
import { apiError, ApiErrorCode } from '$lib/server/api-errors';
import { apiRoute } from '$lib/server/api/v1/route';

/** The acting org's record — name, slug, and branding asset URLs. */
export const GET: RequestHandler = apiRoute(
	'Failed to load organization',
	async ({ params, locals }) => {
		const { ctx, orgId } = requireActingOrg(locals, params.orgId);

		const org = await getOrganizationProvider().getOrg(ctx, orgId);
		if (!org) apiError(404, ApiErrorCode.NOT_FOUND, 'Organization not found');
		return json(org);
	}
);
