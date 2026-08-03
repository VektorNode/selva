import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getOrganizationProvider } from '$lib/server/providers.server';
import { requireActingOrg } from '$lib/server/access.server';
import { handleApiError, apiError, ApiErrorCode } from '$lib/server/api-errors';

/** The acting org's record — name, slug, and branding asset URLs. */
export const GET: RequestHandler = async ({ params, locals }) => {
	const { ctx, orgId } = requireActingOrg(locals, params.orgId);

	try {
		const org = await getOrganizationProvider().getOrg(ctx, orgId);
		if (!org) apiError(404, ApiErrorCode.NOT_FOUND, 'Organization not found');
		return json(org);
	} catch (err) {
		handleApiError(err, 'Failed to load organization');
	}
};
