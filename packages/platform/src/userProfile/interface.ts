import type { UserManagementResult } from '../auth/types.js';
import type { RequestContext } from '../context.js';
import type { RecentRun, UserProfile } from './types.js';

/**
 * Mutable per-user profile state — separate from `IAuthProvider` so OAuth
 * providers (Entra, Supabase Auth) don't have to model fields they can't
 * persist.
 *
 * Adapters MUST scope by `ctx`: a caller cannot read or modify another
 * user's profile via the `userId` argument. SQL adapters delegate to RLS;
 * document-store adapters check `ctx.userId === userId` (or
 * `instance_admin` for admin tooling). Pass `SYSTEM_CONTEXT` for trusted
 * server flows (auto-seed on signup, janitors).
 */
export interface IUserProfileStore {
	/** Returns null when no profile row exists — treat as `emptyProfile(id)`. */
	getProfile(ctx: RequestContext, userId: string): Promise<UserProfile | null>;

	/** Missing users are omitted; order is not guaranteed. */
	getProfiles(ctx: RequestContext, userIds: readonly string[]): Promise<UserProfile[]>;

	updateProfile(
		ctx: RequestContext,
		userId: string,
		patch: { displayName?: string }
	): Promise<UserManagementResult>;

	/** No-op if already starred. */
	starDefinition(
		ctx: RequestContext,
		userId: string,
		definitionId: string
	): Promise<UserManagementResult>;

	/** No-op if not starred. */
	unstarDefinition(
		ctx: RequestContext,
		userId: string,
		definitionId: string
	): Promise<UserManagementResult>;

	/**
	 * Record a solve run. Adapters cap the list (e.g. 20) and dedupe by
	 * `definitionId`.
	 */
	recordRun(ctx: RequestContext, userId: string, run: RecentRun): Promise<UserManagementResult>;
}
