import type {
	IUserProfileStore,
	RecentRun,
	UserManagementResult,
	UserProfile
} from '@selva/platform';
import { ProviderError } from '@selva/platform';
import type { ClientBundle } from '../data/client.js';

/**
 * User profile backed by `public.user_profiles` (one row per `auth.users.id`).
 * The row is auto-seeded by the `handle_new_auth_user` trigger on signup, so
 * the store never inserts — only reads/updates.
 *
 * The `IUserProfileStore` contract doesn't take a RequestContext (profile
 * reads happen at layout-load time, admin-list time, etc. — no obvious
 * per-user scope). We use the service-role client. RLS on `user_profiles`
 * still restricts user-scoped writes to own-row; the service-role path here
 * is intended for server-side flows (hooks.server.ts profile loading,
 * admin pages).
 */
const MAX_RECENT_RUNS = 20;

export class SupabaseUserProfileProvider implements IUserProfileStore {
	constructor(private readonly clients: ClientBundle) {}

	private client() {
		return this.clients.serviceClient;
	}

	async getProfile(userId: string): Promise<UserProfile | null> {
		const { data, error } = await this.client()
			.from('user_profiles')
			.select('user_id, display_name, starred_definitions, recent_runs')
			.eq('user_id', userId)
			.maybeSingle();
		if (error) throw mapError(error);
		return data ? rowToProfile(data) : null;
	}

	async getProfiles(userIds: readonly string[]): Promise<UserProfile[]> {
		if (userIds.length === 0) return [];
		const { data, error } = await this.client()
			.from('user_profiles')
			.select('user_id, display_name, starred_definitions, recent_runs')
			.in('user_id', [...userIds]);
		if (error) throw mapError(error);
		return (data ?? []).map(rowToProfile);
	}

	async updateProfile(
		userId: string,
		patch: { displayName?: string }
	): Promise<UserManagementResult> {
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
		userId: string,
		definitionId: string
	): Promise<UserManagementResult> {
		// Read-modify-write is fine for the local scale here; if concurrent
		// starring ever becomes a hotspot, a SECURITY DEFINER RPC using
		// `array_append` + `array_distinct` closes the race.
		const existing = await this.getProfile(userId);
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
		userId: string,
		definitionId: string
	): Promise<UserManagementResult> {
		const existing = await this.getProfile(userId);
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

	async recordRun(userId: string, run: RecentRun): Promise<UserManagementResult> {
		const existing = await this.getProfile(userId);
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
		return new Error(obj.code ? `[${obj.code}] ${obj.message ?? ''}` : obj.message ?? String(e));
	}
	return new Error(String(e));
}
