/**
 * The acting org's record and roster.
 *
 * `requireActingOrg` is the tenancy gate on both: the URL `orgId` must equal
 * `ctx.actingOrgId`, so the URL alone never decides which tenant is read.
 */

import { apiError, ApiErrorCode, collection, type ApiHandler } from '@selvajs/server/api';
import { requireActingOrg } from '../../access.server';
import { parseListOptions } from '../../pagination.server';

/** The acting org's record — name, slug, and branding asset URLs. */
export const getOrg: ApiHandler = async (req) => {
	const { ctx, orgId } = requireActingOrg(req, req.params.orgId);

	const org = await req.deps.orgs.getOrg(ctx, orgId);
	if (!org) apiError(404, ApiErrorCode.NOT_FOUND, 'Organization not found');
	return { body: org };
};

/**
 * List the org's members. Any member of the acting org may read this — the
 * roster is what the team page renders, and `requireActingOrg` already confines
 * the read to the caller's own tenant.
 */
export const listOrgMembers: ApiHandler = async (req) => {
	const { ctx, orgId } = requireActingOrg(req, req.params.orgId);

	return collection(await req.deps.orgs.listOrgMembers(ctx, orgId, parseListOptions(req.url)));
};
