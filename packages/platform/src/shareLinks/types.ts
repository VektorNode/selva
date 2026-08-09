import type { DefinitionChannel } from '../definitions/types.js';

/**
 * Per-definition token granting access to one (definitionId, channel)
 * without an account. The plaintext token is shown to the minter exactly
 * once; `tokenHash` is the HMAC stored at rest.
 */
export interface ShareLink {
	id: string;
	definitionId: string;
	channel: DefinitionChannel;
	tokenHash: string;
	/** e.g. "Demo for Acme". */
	name?: string;
	createdBy: string;
	createdAt: string;
	/** Null = never expires. */
	expiresAt?: string | null;
	/** Non-null = revoked. */
	revokedAt?: string | null;
	/** false = view/schema only; true = solve allowed. */
	allowSolve: boolean;
	/** Null = unlimited. */
	maxSolves?: number | null;
	solveCount: number;
}

/**
 * Default cap applied when the minter doesn't specify one. Tokens are
 * leak-prone by design (visible in iframes), so a default bounds the
 * worst-case denial-of-wallet damage.
 */
export const DEFAULT_SHARE_LINK_MAX_SOLVES = 1000;
