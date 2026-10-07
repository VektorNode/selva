/** The scope sets the token form offers. Each covers the whole org. */
export const ACCESS_PRESETS = {
	read: { label: 'Read', scopes: ['read:all'] },
	solve: { label: 'Read and run solves', scopes: ['solve:all'] },
	write: { label: 'Read and change', scopes: ['write:all'] },
	full: { label: 'Read, change and run solves', scopes: ['write:all', 'solve:all'] }
} as const;

export type AccessPreset = keyof typeof ACCESS_PRESETS;

export interface TokenRow {
	id: string;
	userId: string;
	name: string;
	scopes: string[];
	createdAt: string;
	expiresAt: string;
	lastUsedAt: string | null;
	revokedAt: string | null;
	refusedToday: number;
}

export type TokenState = 'live' | 'revoked' | 'expired';

const DAY = 86_400_000;

export function tokenState(t: TokenRow, now = Date.now()): TokenState {
	if (t.revokedAt) return 'revoked';
	return Date.parse(t.expiresAt) <= now ? 'expired' : 'live';
}

/** Warnings worth a badge on a live token. Empty for revoked and expired ones. */
export function tokenWarnings(t: TokenRow, now = Date.now()): string[] {
	if (tokenState(t, now) !== 'live') return [];
	const out: string[] = [];
	if (Date.parse(t.expiresAt) - now < 7 * DAY) out.push('Expires soon');
	const lastSeen = Date.parse(t.lastUsedAt ?? t.createdAt);
	if (now - lastSeen > 30 * DAY) out.push('Unused for 30 days');
	if (t.refusedToday > 0) out.push(`Refused ${t.refusedToday}× today`);
	return out;
}
