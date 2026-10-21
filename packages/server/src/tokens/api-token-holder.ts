import {
	hasPermission,
	parseApiScope,
	type ApiScope,
	type RequestContext
} from '@selvajs/platform';
import { canCreateDefinitionInOrg, type VisibilityDeps } from '../definitions/visibility.js';

/**
 * Who may hold an API token with `scopes` in the context's acting org, decided
 * by the host. It replaces the default rule ({@link canHoldApiTokens}) whole.
 *
 * Asked at mint, and again by the resolver on every request against the
 * owner's live context in the token's org, so a key stops working (403
 * `API_TOKEN_HOLDER_REFUSED`) the moment its owner no longer qualifies,
 * without being revoked.
 */
export type ApiTokenHolderPolicy = (
	ctx: RequestContext,
	scopes: readonly ApiScope[]
) => boolean | Promise<boolean>;

export interface ApiTokenHolderOptions {
	policy?: ApiTokenHolderPolicy;
	/** What the default rule reads to find a project the owner may create a definition in. */
	deps: VisibilityDeps;
}

/**
 * May `ctx` hold a key with `scopes` in its acting org? Without a host policy:
 *
 * - `manage_api_tokens` holds any key.
 * - A key that only reads and uploads needs only the right to create a
 *   definition in one project of the org. It can do nothing the owner's
 *   browser session can't.
 *
 * A scope this version can't parse counts as broad, so it needs
 * `manage_api_tokens`.
 */
export async function canHoldApiTokens(
	ctx: RequestContext,
	scopes: readonly string[],
	{ policy, deps }: ApiTokenHolderOptions
): Promise<boolean> {
	const parsed = scopes.map(parseApiScope).filter((s): s is ApiScope => s !== null);
	if (policy) return policy(ctx, parsed);
	if (hasPermission(ctx, 'manage_api_tokens')) return true;

	const readAndUploadOnly =
		parsed.length > 0 &&
		parsed.length === scopes.length &&
		parsed.every((s) => s.action === 'read' || s.action === 'upload');
	if (!readAndUploadOnly || !ctx.actingOrgId) return false;
	return canCreateDefinitionInOrg(ctx, ctx.actingOrgId, deps);
}
