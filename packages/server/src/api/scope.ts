import type { ApiScopeAction, RequestContext, ScopeTarget } from '@selvajs/platform';
import { scopeAllows } from '@selvajs/platform';
import { apiError, ApiErrorCode } from './errors.js';
import type { ApiRequest } from './types.js';

/** The default action for a method: reads are `read`, everything else `write`. */
export function actionForMethod(method: string): ApiScopeAction {
	return method === 'GET' || method === 'HEAD' ? 'read' : 'write';
}

/**
 * Refuse an API-token request its scopes don't cover, with 403 naming the
 * scope that would have passed. Browser sessions always pass.
 *
 * `runHandler` calls this for every mounted route. A route that builds its own
 * `Response` must call it itself.
 */
export function assertScope(
	ctx: RequestContext | undefined,
	action: ApiScopeAction,
	target?: ScopeTarget
): void {
	if (!ctx?.apiScope || scopeAllows(ctx, action, target)) return;
	recordRefusal(ctx.apiScope.tokenId);
	apiError(403, ApiErrorCode.FORBIDDEN, `This API token doesn't allow ${action} here.`, undefined, {
		requiredScope: requiredScope(ctx, action, target)
	});
}

// Per process and per UTC day, so the token page can flag a misconfigured
// integration. Kept in memory on purpose: refusals are not audited.
const refusals = new Map<string, { day: string; count: number }>();

const utcDay = () => new Date().toISOString().slice(0, 10);

function recordRefusal(tokenId: string): void {
	const day = utcDay();
	const entry = refusals.get(tokenId);
	if (entry?.day === day) entry.count++;
	else refusals.set(tokenId, { day, count: 1 });
}

/** Scope refusals for `tokenId` since midnight UTC, in this process. */
export function scopeRefusalsToday(tokenId: string): number {
	const entry = refusals.get(tokenId);
	return entry?.day === utcDay() ? entry.count : 0;
}

function requiredScope(ctx: RequestContext, action: ApiScopeAction, target?: ScopeTarget): string {
	if (target?.projectId) return `${action}:project:${target.projectId}`;
	if (target?.definitionId) return `${action}:definition:${target.definitionId}`;
	return `${action}:org:${ctx.actingOrgId}`;
}

/** Scope target for routes addressed by a project id param. */
export function projectScopeTarget(param = 'id') {
	return (req: ApiRequest): ScopeTarget => ({ projectId: req.params[param] });
}

/**
 * Scope target for routes addressed by a definition guid param. Loads the
 * record so a project-scoped key reaches the definitions inside its project.
 */
export function definitionScopeTarget(param = 'guid') {
	return async (req: ApiRequest): Promise<ScopeTarget> => {
		const definitionId = req.params[param];
		if (!definitionId || !req.ctx) return { definitionId };
		const record = await req.deps.definitionMeta.get(req.ctx, definitionId);
		return { definitionId, projectId: record?.projectId };
	};
}
