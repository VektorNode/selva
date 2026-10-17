import { hasPermission, type RequestContext } from '@selvajs/platform';

/**
 * Who may hold API tokens in the context's acting org, decided by the host.
 * Without one, holding a key needs the platform permission `manage_api_tokens`.
 *
 * Asked at mint, and again by the resolver on every request against the
 * owner's live context in the token's org, so a key stops working (403
 * `API_TOKEN_HOLDER_REFUSED`) the moment its owner no longer qualifies,
 * without being revoked.
 */
export type ApiTokenHolderPolicy = (ctx: RequestContext) => boolean;

/** The one place the "no policy means `manage_api_tokens`" default lives. */
export function canHoldApiTokens(ctx: RequestContext, policy?: ApiTokenHolderPolicy): boolean {
	return policy ? policy(ctx) : hasPermission(ctx, 'manage_api_tokens');
}
