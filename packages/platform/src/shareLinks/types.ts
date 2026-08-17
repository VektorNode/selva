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
 * A share link plus the definition and project it hangs off.
 *
 * The org-wide roster is the one read where the parent matters: `definitionId`
 * alone identifies nothing a person can recognize, and revoking the wrong link
 * is unrecoverable — the raw token is gone.
 *
 * `tokenHash` is omitted, not merely unused. This is the only share-link shape
 * built for a page, and the roster spans every definition in the org — so a
 * careless `JSON.stringify` here would ship every credential digest in the
 * tenant to the browser at once.
 */
export interface OrgShareLink extends Omit<ShareLink, 'tokenHash'> {
	definitionName: string;
	projectId: string;
	projectName: string;
}

/**
 * Default cap applied when the minter doesn't specify one. Tokens are
 * leak-prone by design (visible in iframes), so a default bounds the
 * worst-case denial-of-wallet damage.
 */
export const DEFAULT_SHARE_LINK_MAX_SOLVES = 1000;
