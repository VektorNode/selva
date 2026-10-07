import type { RequestContext } from '../context.js';
import { ProviderError } from '../errors.js';
import { parseApiScope, type ApiScope, type ApiScopeAction, type ApiToken } from './types.js';

/** The rows a request touches, when the route knows them. */
export interface ScopeTarget {
	projectId?: string;
	definitionId?: string;
}

/**
 * May this request perform `action` on `target`?
 *
 * Without a target this is an org-level check, which only `all` and org scopes
 * pass: a project key must never reach a route that can't say which project it
 * touches. Requests without an API token always pass; their permissions are
 * checked elsewhere.
 */
export function scopeAllows(
	ctx: RequestContext,
	action: ApiScopeAction,
	target?: ScopeTarget
): boolean {
	const api = ctx.apiScope;
	if (!api) return true;
	return api.scopes.some((s) => actionCovers(s.action, action) && resourceCovers(s, ctx, target));
}

function actionCovers(granted: ApiScopeAction, wanted: ApiScopeAction): boolean {
	return granted === wanted || wanted === 'read';
}

function resourceCovers(scope: ApiScope, ctx: RequestContext, target?: ScopeTarget): boolean {
	const { resource } = scope;
	switch (resource.kind) {
		case 'all':
			return true;
		case 'org':
			return resource.id === ctx.actingOrgId;
		case 'project':
			return target?.projectId === resource.id;
		case 'definition':
			return target?.definitionId === resource.id;
	}
}

/**
 * Narrow the owner's live context to what the token grants. Only removes
 * rights:
 *
 * - Platform permissions are dropped. Instance authority never rides on a
 *   bearer key, so an operator's leaked key can't reach other tenants.
 * - `apiScope` is attached, which `scopeAllows` reads.
 *
 * Scopes this version can't parse are dropped, so they grant nothing.
 */
export function narrowApiTokenContext(
	ctx: RequestContext,
	token: Pick<ApiToken, 'id' | 'orgId' | 'scopes'>
): RequestContext {
	if (ctx.actingOrgId !== token.orgId) {
		throw new ProviderError('API token context must act in the token’s org', 500);
	}
	const scopes = token.scopes.map(parseApiScope).filter((s): s is ApiScope => s !== null);
	return { ...ctx, platformPermissions: [], apiScope: { tokenId: token.id, scopes } };
}
