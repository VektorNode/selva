import type { DefinitionChannel } from '../definitions/types.js';

/**
 * Spec §7 — per-definition token granting access to one (definitionId, channel)
 * without an account. Replaces both share-by-link and the old anonymous-embed
 * abuse-control story.
 *
 * The raw token is HMAC-hashed at rest; `tokenHash` here is the stored value.
 * The plaintext token is shown to the minter exactly once at creation.
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
	/** ISO timestamp; null = never expires. */
	expiresAt?: string | null;
	/** ISO timestamp; non-null = revoked. Resolution checks IS NULL. */
	revokedAt?: string | null;
	/** false = view/schema only; true = solve allowed. */
	allowSolve: boolean;
	/** Per-link cap. null = unlimited. Default applied at the route layer. */
	maxSolves?: number | null;
	/** Atomic increment on each successful solve. */
	solveCount: number;
}

/**
 * Default solve cap applied when a minter doesn't specify one. Tokens are
 * leak-prone by design (anyone viewing an iframe sees them), so a default
 * exists to bound the worst-case denial-of-wallet damage. The minter can
 * raise or remove it explicitly.
 */
export const DEFAULT_SHARE_LINK_MAX_SOLVES = 1000;
