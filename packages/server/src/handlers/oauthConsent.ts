/**
 * The server half of an OAuth consent screen: which access levels the user may
 * grant, and minting the key.
 *
 * A key is bound to one org at mint, and consent mints only in the session's
 * acting org: the token page lists and revokes keys there alone, so a key
 * minted elsewhere would be live with no way to see or revoke it.
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
 * The orgs the signed-in user may grant a key with `scopes` in: their acting
 * org, when they may hold such a key there. At most one.
 */
export async function consentOrgs(
	req: ApiRequest,
	scopes: readonly string[]
): Promise<ConsentOrg[]> {
	const { ctx } = requireCaller(req);
	const memberships = (await listUserMemberships(req.deps.orgs, ctx.userId)).filter(
		({ org }) => org.id === ctx.actingOrgId
	);
	const allowed = await Promise.all(
		memberships.map(async ({ member }) =>
			mayHoldApiTokens(req.deps, await contextIn(req, member), scopes)
		)
	);
	return memberships
		.filter((_, i) => allowed[i])
		.map(({ org }) => ({ id: org.id, name: org.name }));
}

export interface ConsentLevel {
	choice: ConsentChoice;
	/** Where this level may be granted. Never empty. */
	orgs: ConsentOrg[];
}

export interface ConsentOffer {
	/**
	 * Narrowest first. Only levels the user may hold in at least one of their
	 * orgs; each carries its own orgs, since a narrower level can reach more.
	 */
	levels: ConsentLevel[];
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
	return offered.length ? { levels: offered } : null;
}

/**
 * Mint the key a consent grants, in `orgId`. Anything but the acting org is
 * refused here, whatever the form said.
 */
export async function mintConsentToken(
	req: ApiRequest,
	orgId: string,
	input: MintApiTokenInput
): Promise<MintedApiToken> {
	const { ctx } = requireCaller(req);
	if (orgId !== ctx.actingOrgId) {
		apiError(
			403,
			ApiErrorCode.FORBIDDEN,
			'Apps can only be connected to your current organization.'
		);
	}
	// Matched against the user's own memberships, so the posted id never reaches a store query.
	const memberships = await listUserMemberships(req.deps.orgs, ctx.userId);
	const picked = memberships.find(({ org }) => org.id === orgId);
	if (!picked) {
		apiError(403, ApiErrorCode.FORBIDDEN, 'You aren’t a member of that organization.');
	}
	return mintApiToken({ ...req, ctx: await contextIn(req, picked.member) }, input);
}

/**
 * Revoke a consent key whose code was never redeemed, so an abandoned sign-in
 * doesn't leave a live key nobody holds. A used key is kept: its code may have
 * been redeemed on another replica.
 */
export async function revokeUnredeemedConsentToken(
	req: ApiRequest,
	tokenId: string
): Promise<void> {
	const store = req.deps.data.apiTokens;
	if (!store) return;
	const { ctx } = requireCaller(req);
	const token = await store.get(ctx, tokenId);
	if (!token || token.revokedAt || token.lastUsedAt) return;
	await store.revoke(ctx, tokenId, 'owner');
}
