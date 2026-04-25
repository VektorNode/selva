import type { RecentRun, UserManagementResult } from '../auth/types.js';
import type { RequestContext } from '../context.js';
import type { UserProfile } from './types.js';

/**
 * User-profile data store. Owns mutable profile state (display name,
 * starred definitions, recent run history) — distinct from `IAuthProvider`,
 * which owns identity verification and permissions.
 *
 * Lives separately so OAuth providers (Entra, Supabase Auth) don't have to
 * stub out profile methods: identity comes from the OIDC provider, profile
 * state from your DB.
 *
 * ## Auth boundary
 *
 * Every method takes a `RequestContext` as its first argument. **The query
 * itself is the security boundary** — adapters MUST scope reads/writes by
 * `ctx` so that a caller cannot read or modify another user's profile via
 * the `userId` argument. SQL adapters delegate to RLS via the user-scoped
 * client; document-store adapters check `ctx.userId === userId` (or
 * `ctx.platformPermissions.includes('instance_admin')` for admin tooling).
 *
 * Pass `SYSTEM_CONTEXT` for trusted server-side flows (auto-seed on signup,
 * background janitors). Never derive a fresh `ctx` from a route param.
 */
export interface IUserProfileStore {
	/**
	 * Read a profile by user id. Returns null when no profile row exists
	 * (callers can treat this as the same as an empty profile via `emptyProfile(id)`).
	 */
	getProfile(ctx: RequestContext, userId: string): Promise<UserProfile | null>;

	/**
	 * Batch-read profiles for a set of user ids. Missing users are simply
	 * omitted from the result. Order is not guaranteed.
	 */
	getProfiles(ctx: RequestContext, userIds: readonly string[]): Promise<UserProfile[]>;

	/** Update mutable profile fields (display name, etc.). */
	updateProfile(
		ctx: RequestContext,
		userId: string,
		patch: { displayName?: string }
	): Promise<UserManagementResult>;

	/** Star (pin) a definition for quick access. No-op if already starred. */
	starDefinition(
		ctx: RequestContext,
		userId: string,
		definitionId: string
	): Promise<UserManagementResult>;

	/** Unstar a definition. No-op if not starred. */
	unstarDefinition(
		ctx: RequestContext,
		userId: string,
		definitionId: string
	): Promise<UserManagementResult>;

	/**
	 * Record a solve run for this user. Implementations should cap the list
	 * to a recent window (e.g. 20 entries) and dedupe by `definitionId`.
	 */
	recordRun(
		ctx: RequestContext,
		userId: string,
		run: RecentRun
	): Promise<UserManagementResult>;
}
