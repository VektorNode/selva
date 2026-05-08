export interface RecentRun {
	definitionId: string;
	runId: string;
	definitionName: string;
	timestamp: string;
}

/**
 * Mutable per-user profile state. Owned by `IUserProfileStore` so OIDC
 * providers (Supabase Auth, Entra, Firebase) don't have to model fields they
 * can't persist — identity from the IdP, profile state from your DB.
 */
export interface UserProfile {
	userId: string;
	displayName?: string;
	/** Definition GUIDs pinned by this user. */
	starredDefinitions: string[];
	/** Last N solve runs, newest first. Capped by the adapter. */
	recentRuns: RecentRun[];
}

export function emptyProfile(userId: string): UserProfile {
	return { userId, starredDefinitions: [], recentRuns: [] };
}
