import type { RecentRun } from '../auth/types.js';

/**
 * Mutable per-user profile state. Owned by `IUserProfileStore`, not by
 * `IAuthProvider` — identity comes from the IdP, profile state from your DB.
 *
 * Keeps OIDC providers (Supabase Auth, Entra, Firebase) honest: they don't
 * have to stub out fields they can't persist.
 */
export interface UserProfile {
	userId: string;
	/** Free-text display name chosen by the user. */
	displayName?: string;
	/** Definition GUIDs pinned by this user for quick access. */
	starredDefinitions: string[];
	/** Last N solve runs across all definitions, newest first. Capped by the adapter. */
	recentRuns: RecentRun[];
}

/** Empty profile — used as a placeholder when a user has no profile row yet. */
export function emptyProfile(userId: string): UserProfile {
	return {
		userId,
		starredDefinitions: [],
		recentRuns: []
	};
}
