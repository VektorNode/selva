import type {
	IUserProfileStore,
	RecentRun,
	RequestContext,
	UserManagementResult,
	UserProfile
} from '@selvajs/platform';
import { ProviderError, hasPermission } from '@selvajs/platform';
import type { ClientBundle } from '../data/client.js';

/**
 * User profile backed by `public.user_profiles` (one row per `auth.users.id`).
 * The row is auto-seeded by the `handle_new_auth_user` trigger on signup, so
 * the store never inserts — only reads/updates.
 *
 * Uses the service-role client throughout (RLS on `user_profiles` is
 * coarse-grained — server-side flows like the hooks.server.ts profile load
 * need access regardless of the caller's identity). The `assertCanAccess`
 * check enforces "you can only see/modify your own profile" at the app layer
 * to match the `IUserProfileStore` contract.
 */
const MAX_RECENT_RUNS = 20;

export class SupabaseUserProfileProvider implements IUserProfileStore {
	constructor(private readonly clients: ClientBundle) {}

	private client() {
		return this.clients.serviceClient;
	}

	async getProfile(ctx: RequestContext, userId: string): Promise<UserProfile | null> {
		assertCanAccess(ctx, userId);
		const { data, error } = await this.client()
			.from('user_profiles')
			.select('user_id, display_name, starred_definitions, recent_runs')
			.eq('user_id', userId)
			.maybeSingle();
		if (error) throw mapError(error);
		return data ? rowToProfile(data) : null;
	}

	async getProfiles(_ctx: RequestContext, userIds: readonly string[]): Promise<UserProfile[]> {
		// Batch read serves display-name lookups across the UI; scoping to one
		// user defeats the purpose. No assertCanAccess.
		if (userIds.length === 0) return [];
		const { data, error } = await this.client()
			.from('user_profiles')
			.select('user_id, display_name, starred_definitions, recent_runs')
			.in('user_id', [...userIds]);
		if (error) throw mapError(error);
		return (data ?? []).map(rowToProfile);
	}

	async updateProfile(
		ctx: RequestContext,
		userId: string,
		patch: { displayName?: string }
	): Promise<UserManagementResult> {
		assertCanAccess(ctx, userId);
		const row: Record<string, unknown> = {};
		if (patch.displayName !== undefined) row.display_name = patch.displayName;
		if (Object.keys(row).length === 0) return 'ok';

		const { data, error } = await this.client()
			.from('user_profiles')
			.update(row)
			.eq('user_id', userId)
			.select('user_id');
		if (error) throw mapError(error);
		return data && data.length > 0 ? 'ok' : 'not_found';
	}

	async starDefinition(
		ctx: RequestContext,
		userId: string,
		definitionId: string
	): Promise<UserManagementResult> {
		assertCanAccess(ctx, userId);
		// Read-modify-write is fine for the local scale here; if concurrent
		// starring ever becomes a hotspot, a SECURITY DEFINER RPC using
		// `array_append` + `array_distinct` closes the race.
		const existing = await this.getProfile(ctx, userId);
		if (!existing) return 'not_found';
		if (existing.starredDefinitions.includes(definitionId)) return 'ok';

		const next = [...existing.starredDefinitions, definitionId];
		const { data, error } = await this.client()
			.from('user_profiles')
			.update({ starred_definitions: next })
			.eq('user_id', userId)
			.select('user_id');
		if (error) throw mapError(error);
		return data && data.length > 0 ? 'ok' : 'not_found';
	}

	async unstarDefinition(
		ctx: RequestContext,
		userId: string,
		definitionId: string
	): Promise<UserManagementResult> {
		assertCanAccess(ctx, userId);
		const existing = await this.getProfile(ctx, userId);
		if (!existing) return 'not_found';
		if (!existing.starredDefinitions.includes(definitionId)) return 'ok';

		const next = existing.starredDefinitions.filter((id) => id !== definitionId);
		const { data, error } = await this.client()
			.from('user_profiles')
			.update({ starred_definitions: next })
			.eq('user_id', userId)
			.select('user_id');
		if (error) throw mapError(error);
		return data && data.length > 0 ? 'ok' : 'not_found';
	}

	async recordRun(
		ctx: RequestContext,
		userId: string,
		run: RecentRun
	): Promise<UserManagementResult> {
		assertCanAccess(ctx, userId);
		const existing = await this.getProfile(ctx, userId);
		if (!existing) return 'not_found';

		// Prepend newest, de-dupe by definitionId, cap at MAX_RECENT_RUNS.
		const filtered = existing.recentRuns.filter((r) => r.definitionId !== run.definitionId);
		const next = [run, ...filtered].slice(0, MAX_RECENT_RUNS);

		const { data, error } = await this.client()
			.from('user_profiles')
			.update({ recent_runs: next })
			.eq('user_id', userId)
			.select('user_id');
		if (error) throw mapError(error);
		return data && data.length > 0 ? 'ok' : 'not_found';
	}
}

function assertCanAccess(ctx: RequestContext, userId: string): void {
	if (ctx.system) return;
	if (ctx.userId === userId) return;
	if (hasPermission(ctx, 'instance_admin')) return;
	throw new ProviderError('Forbidden: cannot access another user’s profile', 403);
}

interface ProfileRow {
	user_id: string;
	display_name: string | null;
	starred_definitions: string[] | null;
	recent_runs: RecentRun[] | null;
}

function rowToProfile(row: ProfileRow): UserProfile {
	return {
		userId: row.user_id,
		displayName: row.display_name ?? undefined,
		starredDefinitions: row.starred_definitions ?? [],
		recentRuns: row.recent_runs ?? []
	};
}

interface PostgrestError {
	code?: string;
	message?: string;
}

function mapError(e: unknown): Error {
	const pg = e as PostgrestError;
	if (pg?.code === '23505') return new ProviderError(pg.message ?? 'Duplicate record', 409);
	if (pg?.code === '23503') return new ProviderError(pg.message ?? 'Foreign key violation', 409);
	if (e instanceof Error) return e;
	if (e && typeof e === 'object') {
		const obj = e as { message?: string; code?: string };
		return new Error(obj.code ? `[${obj.code}] ${obj.message ?? ''}` : (obj.message ?? String(e)));
	}
	return new Error(String(e));
}
