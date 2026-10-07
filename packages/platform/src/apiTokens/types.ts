import { z } from 'zod';

/** `write` and `solve` each include `read`; neither includes the other. */
export const ApiScopeActionSchema = z.enum(['read', 'write', 'solve']);
export type ApiScopeAction = z.infer<typeof ApiScopeActionSchema>;

/**
 * What one scope covers. A token is bound to one org, so `all` and that org's
 * `org` resource reach the same rows; both exist so a host app can store
 * either without translating.
 */
export type ApiScopeResource =
	| { kind: 'all' }
	| { kind: 'org'; id: string }
	| { kind: 'project'; id: string }
	| { kind: 'definition'; id: string };

export interface ApiScope {
	action: ApiScopeAction;
	resource: ApiScopeResource;
}

// Ids are uuids or guids in practice; the charset only has to keep `:` out so
// the string form stays unambiguous.
const SCOPE_PATTERN = /^(read|write|solve):(all|(org|project|definition):([A-Za-z0-9_-]{1,128}))$/;

/** `read:all`, `write:org:<id>`, `solve:project:<id>`, `read:definition:<guid>`. */
export function parseApiScope(value: string): ApiScope | null {
	const m = SCOPE_PATTERN.exec(value);
	if (!m) return null;
	const action = m[1] as ApiScopeAction;
	if (m[2] === 'all') return { action, resource: { kind: 'all' } };
	return { action, resource: { kind: m[3] as 'org' | 'project' | 'definition', id: m[4]! } };
}

export function formatApiScope(scope: ApiScope): string {
	const { action, resource } = scope;
	return resource.kind === 'all' ? `${action}:all` : `${action}:${resource.kind}:${resource.id}`;
}

/**
 * Scopes are stored as strings so a new action or resource kind needs no
 * migration. Parsing rejects anything this version doesn't understand, so an
 * unknown scope grants nothing rather than being guessed at.
 */
export const ApiScopeStringSchema = z
	.string()
	.refine((s) => parseApiScope(s) !== null, { message: 'Unknown scope' });

/**
 * A long-lived bearer credential acting as `userId` inside `orgId`, narrowed by
 * `scopes`. The raw key is shown once at mint; the store holds only its HMAC.
 */
export interface ApiToken {
	id: string;
	/** The user the token acts as. Erasing them deletes the token. */
	userId: string;
	/**
	 * Who minted it. Equal to `userId` until service accounts exist; null once
	 * the minting user is erased.
	 */
	createdBy: string | null;
	orgId: string;
	/** Free text the owner chose. Personal data in practice ("Felix laptop"), so never logged or audited. */
	name: string;
	/** `HMAC-SHA256(SELVA_HMAC_KEY, rawToken)`, base64url. */
	tokenHash: string;
	/** String form, see {@link parseApiScope}. At least one. */
	scopes: string[];
	createdAt: string;
	expiresAt: string;
	lastUsedAt: string | null;
	/** Revoked rows stay so a `tokenId` in the audit log still resolves to a name. */
	revokedAt: string | null;
}

/** What listing returns: the hash never leaves the store on a read path. */
export type ApiTokenSummary = Omit<ApiToken, 'tokenHash'>;

export const ApiTokenRevokeReasonSchema = z.enum([
	'owner',
	'admin',
	'member_removed',
	'user_disabled'
]);
export type ApiTokenRevokeReason = z.infer<typeof ApiTokenRevokeReasonSchema>;

/** The only lifetimes offered. Expiry is never optional. */
export const API_TOKEN_LIFETIME_DAYS = [30, 90, 180] as const;
export type ApiTokenLifetimeDays = (typeof API_TOKEN_LIFETIME_DAYS)[number];

const ACTION_WORDS: Record<ApiScopeAction, string> = {
	read: 'Read',
	write: 'Read and change',
	solve: 'Read and run solves on'
};

/** "Read and change everything in the org". Names no ids, so it suits an email. */
export function describeApiScope(value: string): string {
	const scope = parseApiScope(value);
	if (!scope) return `Unknown scope (${value})`;
	const what =
		scope.resource.kind === 'project'
			? 'one project'
			: scope.resource.kind === 'definition'
				? 'one definition'
				: 'everything in the org';
	return `${ACTION_WORDS[scope.action]} ${what}`;
}
