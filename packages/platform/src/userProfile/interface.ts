import type { RecentRun, UserManagementResult } from '../auth/types.js';

/**
 * User-profile data store. Owns mutable profile state (display name,
 * starred definitions, recent run history) — distinct from `IAuthProvider`,
 * which owns identity verification and permissions.
 *
 * Lives separately so OAuth providers (Entra, Supabase Auth) don't have to
 * stub out profile methods: identity comes from the OIDC provider, profile
 * state from your DB.
 */
export interface IUserProfileStore {
	/** Update mutable profile fields (display name, etc.). */
	updateProfile(
		userId: string,
		patch: { displayName?: string }
	): Promise<UserManagementResult>;

	/** Star (pin) a definition for quick access. No-op if already starred. */
	starDefinition(userId: string, definitionId: string): Promise<UserManagementResult>;

	/** Unstar a definition. No-op if not starred. */
	unstarDefinition(userId: string, definitionId: string): Promise<UserManagementResult>;

	/**
	 * Record a solve run for this user. Implementations should cap the list
	 * to a recent window (e.g. 20 entries) and dedupe by `definitionId`.
	 */
	recordRun(userId: string, run: RecentRun): Promise<UserManagementResult>;
}
