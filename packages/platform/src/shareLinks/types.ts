import type { DefinitionChannel } from '../definitions/types.js';

/**
 * Per-definition token granting access to one (definitionId, channel)
 * without an account. The raw token is HMAC-hashed at rest; `tokenHash` is
 * the stored value. The plaintext token is shown to the minter exactly once.
 */
export interface ShareLink {
	id: string;
	definitionId: string;
	channel: DefinitionChannel;
	/** HMAC of the raw token. Lookup hashes the supplied token, then matches. */
	tokenHash: string;
	/** Optional UX label, e.g. "Demo for Acme". */
	name?: string;
	createdBy: string;
	createdAt: string;
	/** Null = never expires. */
	expiresAt?: string | null;
	/** Non-null = revoked. Resolution checks IS NULL. */
	revokedAt?: string | null;
	/** false = view/schema only; true = solve allowed. */
	allowSolve: boolean;
	/** Per-link cap. Null = unlimited. */
	maxSolves?: number | null;
	solveCount: number;
}

/**
 * Default cap applied when the minter doesn't specify one. Tokens are
 * leak-prone by design (visible in iframes), so a default bounds the
 * worst-case denial-of-wallet damage.
 */
export const DEFAULT_SHARE_LINK_MAX_SOLVES = 1000;
