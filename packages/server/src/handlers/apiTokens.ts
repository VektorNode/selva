/**
 * API tokens: mint, list, revoke.
 *
 * **Session-only.** A key can't manage keys, so a leaked one can't mint more or
 * revoke the owner's others to cover its tracks.
 *
 * **The raw key exists only in the mint response.** The store holds its HMAC,
 * and every response goes through a schema that has no `tokenHash`.
 */

import { randomUUID } from 'node:crypto';
import {
	describeApiScope,
	hasPermission,
	parseApiScope,
	type ApiToken,
	type ApiTokenRevokeReason,
	type ApiTokenSummary,
	type IApiTokenStore,
	type ILogger,
	type RequestContext
} from '@selvajs/platform';
import { renderApiTokenCreatedEmail } from '@selvajs/notifications';
import {
	apiError,
	ApiErrorCode,
	ApiTokenResponseSchema,
	CreateApiTokenBodySchema,
	CreatedApiTokenResponseSchema,
	isApiError,
	noContent,
	parseBody,
	parseListOptions,
	requireCaller,
	requireParams,
	scopeRefusalsToday,
	shapedCollection
} from '../api/index.js';
import type { ApiHandler, ApiRequest } from '../api/index.js';
import {
	requireActingOrg,
	requireCanViewProject,
	requireManageOrgMembers,
	requirePermission
} from '../access/index.js';
import type { ApiTokenCodec } from '../tokens/index.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function requireSessionInOrg(req: ApiRequest): { ctx: RequestContext; orgId: string } {
	if (req.ctx?.apiScope) {
		apiError(
			403,
			ApiErrorCode.FORBIDDEN,
			'API tokens can’t manage API tokens. Sign in to the web app to do this.'
		);
	}
	return requireActingOrg(req, req.params.orgId);
}

function unavailable(): never {
	apiError(
		503,
		ApiErrorCode.API_TOKENS_UNAVAILABLE,
		'API tokens are not available on this server.'
	);
}

function storeOf(req: ApiRequest): IApiTokenStore {
	return req.deps.data.apiTokens ?? unavailable();
}

function codecOf(req: ApiRequest): ApiTokenCodec {
	return req.deps.tokens.apiTokens ?? unavailable();
}

function toResponse(token: ApiTokenSummary) {
	return { ...token, refusedToday: scopeRefusalsToday(token.id) };
}

/**
 * Refuse scopes naming something outside this org or out of the creator's
 * sight. Not the security boundary: a key never exceeds its owner's live rights
 * anyway. This stops someone minting a key that can only ever be refused.
 */
async function assertScopesReachable(
	req: ApiRequest,
	orgId: string,
	scopes: readonly string[]
): Promise<void> {
	const refuse = (message: string): never =>
		apiError(400, ApiErrorCode.VALIDATION_FAILED, message, { scopes: message });

	for (const value of scopes) {
		const scope = parseApiScope(value) ?? refuse(`Unknown scope: ${value}`);
		const { resource } = scope;
		if (resource.kind === 'all') continue;
		if (resource.kind === 'org') {
			if (resource.id !== orgId) refuse('An org scope must name this org.');
			continue;
		}

		let projectId = resource.id;
		if (resource.kind === 'definition') {
			const record =
				(await req.deps.definitionMeta.get(req.ctx!, resource.id)) ??
				refuse(`No definition ${resource.id}.`);
			projectId = record.projectId;
		}
		const project = await req.deps.projects.getProject(req.ctx!, projectId);
		if (!project || project.orgId !== orgId)
			refuse(`No ${resource.kind} ${resource.id} in this org.`);
		try {
			await requireCanViewProject(req, projectId);
		} catch (err) {
			if (isApiError(err)) refuse(`You can’t access ${resource.kind} ${resource.id}.`);
			throw err;
		}
	}
}

/**
 * Tell the owner a key now exists on their account, best-effort. The case that
 * matters is the one where they didn't make it.
 */
async function mailTokenCreated(req: ApiRequest, token: ApiToken): Promise<void> {
	const notifications = req.deps.notifications;
	const to = req.user?.email;
	if (!notifications || !to) return;
	try {
		const org = await req.deps.orgs.getOrg(req.ctx!, token.orgId);
		await notifications.send(
			renderApiTokenCreatedEmail({
				to,
				tokenName: token.name,
				orgName: org?.name ?? req.deps.instanceName,
				scopes: token.scopes.map(describeApiScope),
				expiresAt: token.expiresAt,
				manageUrl: `${req.url.origin}${req.deps.apiTokenSettingsPath}`
			}),
			req.log
		);
	} catch (err) {
		req.log.warn('API token mail could not be sent', {
			component: 'ApiTokens',
			tokenId: token.id,
			reason: err instanceof Error ? err.message : String(err)
		});
	}
}

/**
 * The caller's own tokens in this org, newest first, including revoked and
 * expired ones. `?all=true` returns everyone's and needs `manage_org_members`.
 */
export const listApiTokens: ApiHandler = async (req) => {
	const { ctx, orgId } = requireSessionInOrg(req);
	const all = req.url.searchParams.get('all') === 'true';
	if (all) requireManageOrgMembers(req);

	const page = await storeOf(req).listByOrg(ctx, orgId, {
		...parseListOptions(req.url),
		userId: all ? undefined : ctx.userId
	});
	return shapedCollection(ApiTokenResponseSchema, { ...page, items: page.items.map(toResponse) });
};

/** Mint a token acting as the caller. The raw key is in this response and nowhere else. */
export const createApiToken: ApiHandler = async (req) => {
	const { ctx, orgId } = requireSessionInOrg(req);
	requirePermission(req, 'manage_api_tokens');
	const { user } = requireCaller(req);
	const store = storeOf(req);
	const codec = codecOf(req);
	// A key minted now would only ever get 503.
	const delegated = req.deps.auth.delegatedSession;
	if (delegated && !(await delegated.status()).ok) unavailable();

	const input = await parseBody(req.request, CreateApiTokenBodySchema);
	await assertScopesReachable(req, orgId, input.scopes);

	const raw = codec.mintRawToken();
	const now = new Date();
	const token: ApiToken = {
		id: randomUUID(),
		userId: user.id,
		createdBy: user.id,
		orgId,
		name: input.name,
		tokenHash: codec.hashToken(raw),
		scopes: [...new Set(input.scopes)],
		createdAt: now.toISOString(),
		expiresAt: new Date(now.getTime() + input.expiresInDays * DAY_MS).toISOString(),
		lastUsedAt: null,
		revokedAt: null
	};
	await store.create(ctx, token);
	await mailTokenCreated(req, token);

	const { tokenHash: _hash, ...summary } = token;
	return {
		status: 201,
		headers: { 'Cache-Control': 'no-store' },
		body: CreatedApiTokenResponseSchema.parse({ token: toResponse(summary), secret: raw })
	};
};

/**
 * Revoke a token: the owner's own, or anyone's in the org for
 * `manage_org_members`. Someone else's token reads as missing, not forbidden.
 */
export const revokeApiToken: ApiHandler = async (req) => {
	const { ctx, orgId } = requireSessionInOrg(req);
	const { tokenId } = requireParams(req.params, 'tokenId');
	const store = storeOf(req);

	const token = await store.get(ctx, tokenId);
	const own = token?.userId === ctx.userId;
	if (!token || token.orgId !== orgId || (!own && !hasPermission(ctx, 'manage_org_members'))) {
		apiError(404, ApiErrorCode.NOT_FOUND, 'API token not found');
	}
	await store.revoke(ctx, tokenId, own ? 'owner' : 'admin');
	return noContent();
};

/**
 * Revoke every live key `userId` holds, in one org or (no `orgId`) all of
 * them. Call it when someone leaves an org or is disabled: the resolver already
 * refuses those keys, but without this they would work again the moment the
 * person is re-added or re-enabled.
 *
 * Best effort. The removal or disable has already committed, so a failure is
 * logged rather than thrown.
 */
export async function revokeUserApiTokens(
	store: IApiTokenStore | undefined,
	ctx: RequestContext,
	userId: string,
	opts: { orgId?: string; reason: ApiTokenRevokeReason },
	log: ILogger
): Promise<void> {
	if (!store) return;
	try {
		await store.revokeAllForUser(ctx, userId, opts);
	} catch (err) {
		log.error('Failed to revoke API tokens', {
			component: 'ApiTokens',
			userId,
			orgId: opts.orgId,
			reason: opts.reason,
			err: err instanceof Error ? err.message : String(err)
		});
	}
}
