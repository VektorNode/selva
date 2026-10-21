/**
 * The server half of an OAuth consent screen: which access levels and orgs the
 * user may grant, and minting the key in the org they picked.
 *
 * A key is bound to one org at mint. The user's session acts in one org too,
 * but they may belong to several, so consent builds a context pinned to the
 * picked org rather than trusting the session's.
 */

import type { OrgMember, RequestContext } from '@selvajs/platform';
import { apiError, ApiErrorCode, requireCaller, type ApiRequest } from '../api/index.js';
import { buildRequestContext } from '../http/request-context.js';
import { listUserMemberships } from '../organizations/user-memberships.js';
import {
	apiScopesFor,
	consentChoices,
	type ConsentChoice,
	type OAuthScope
} from '../oauth/index.js';
import {
	mayHoldApiTokens,
	mintApiToken,
	type MintApiTokenInput,
	type MintedApiToken
} from './apiTokens.js';

export interface ConsentOrg {
	id: string;
	name: string;
}

async function contextIn(req: ApiRequest, member: OrgMember): Promise<RequestContext> {
	const { ctx, user } = requireCaller(req);
	if (ctx.apiScope) {
		apiError(403, ApiErrorCode.FORBIDDEN, 'Sign in to the web app to connect an app.');
	}
	const pinned = await buildRequestContext(
		{ user, platformPermissions: ctx.platformPermissions, membership: member, pinOrg: true },
		{ orgs: req.deps.orgs }
	);
	// The session's own adapter payload (Supabase's user JWT) still applies.
	return { ...pinned, adapterContext: ctx.adapterContext };
}

/**
 * The orgs the signed-in user may grant a key with `scopes` in: those they
 * belong to and may hold such a key in.
 */
export async function consentOrgs(
	req: ApiRequest,
	scopes: readonly string[]
): Promise<ConsentOrg[]> {
	const { ctx } = requireCaller(req);
	const memberships = await listUserMemberships(req.deps.orgs, ctx.userId);
	const allowed = await Promise.all(
		memberships.map(async ({ member }) =>
			mayHoldApiTokens(req.deps, await contextIn(req, member), scopes)
		)
	);
	return memberships
		.filter((_, i) => allowed[i])
		.map(({ org }) => ({ id: org.id, name: org.name }));
}

export interface ConsentOffer {
	/** Narrowest first. Only levels the user may hold in at least one of their orgs. */
	choices: ConsentChoice[];
	/** Where the widest choice, the one the page preselects, may be granted. */
	orgs: ConsentOrg[];
}

/**
 * What a consent page offers for a request's scopes, and what its approval
 * accepts. Null when the user may grant none of it anywhere.
 */
export async function consentOffer(
	req: ApiRequest,
	scopes: readonly OAuthScope[]
): Promise<ConsentOffer | null> {
	const levels = await Promise.all(
		consentChoices(scopes).map(async (choice) => ({
			choice,
			orgs: await consentOrgs(req, apiScopesFor(choice.scopes))
		}))
	);
	const offered = levels.filter((l) => l.orgs.length > 0);
	if (!offered.length) return null;
	return { choices: offered.map((l) => l.choice), orgs: offered[offered.length - 1]!.orgs };
}

/**
 * Mint the key a consent grants, acting in `orgId`. An org the user doesn't
 * belong to is refused here, whatever the form said.
 */
export async function mintConsentToken(
	req: ApiRequest,
	orgId: string,
	input: MintApiTokenInput
): Promise<MintedApiToken> {
	const { ctx } = requireCaller(req);
	// Matched against the user's own memberships, so the posted id never reaches a store query.
	const memberships = await listUserMemberships(req.deps.orgs, ctx.userId);
	const picked = memberships.find(({ org }) => org.id === orgId);
	if (!picked) {
		apiError(403, ApiErrorCode.FORBIDDEN, 'You aren’t a member of that organization.');
	}
	return mintApiToken({ ...req, ctx: await contextIn(req, picked.member) }, input);
}
