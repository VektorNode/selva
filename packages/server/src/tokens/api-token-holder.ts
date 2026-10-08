import type { RequestContext } from '@selvajs/platform';

/**
 * Who may hold API tokens in the context's acting org, decided by the host.
 *
 * Without one, minting needs the platform permission `manage_api_tokens`. With
 * one, it replaces that check at mint, and the resolver re-asks it on every
 * request against the owner's live context in the token's org, so a key stops
 * working (403 `API_TOKEN_HOLDER_REFUSED`) the moment its owner no longer
 * qualifies, without being revoked.
 */
export type ApiTokenHolderPolicy = (ctx: RequestContext) => boolean;
