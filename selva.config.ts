/**
 * Selva provider wiring — the single DI point that picks which provider
 * backs auth / data / storage / userProfile, plus tenancy and platform flags.
 *
 * Configuration is env-driven. Every var read here is documented in
 * packages/compute-app/.env.example — that file is the authoritative
 * reference. Don't duplicate env documentation in this header; keep it there.
 *
 * Setup guide:    docs/QuickStart.md
 * Provider depth: packages/local-provider/README.md
 *                 packages/supabase-provider/README.md
 */

import { defineConfig, type SelvaFlags, type TenancyMode } from '@selva/platform';
import * as local from 'selva-local-provider';
import * as supa from '@selva/supabase-provider';

function resolveTenancy(env: Record<string, string | undefined>): TenancyMode {
	return env.SELVA_TENANCY === 'multi' ? 'multi' : 'single';
}

/**
 * Parse platform feature flags from env. Each flag is opt-in via `=true`;
 * anything else (including absence) resolves to false. Keep this strict —
 * cross-org public and anonymous-allowing flags are security-relevant.
 */
function resolveFlags(env: Record<string, string | undefined>): SelvaFlags {
	const on = (v: string | undefined) => v === 'true';
	return {
		ALLOW_CROSS_ORG_PUBLIC: on(env.ALLOW_CROSS_ORG_PUBLIC),
		ALLOW_ORG_COMPUTE_OVERRIDE: on(env.ALLOW_ORG_COMPUTE_OVERRIDE),
		ALLOW_ORG_CREATION: on(env.ALLOW_ORG_CREATION)
	};
}

export default defineConfig((env) => {
	const tenancy = resolveTenancy(env);
	const flags = resolveFlags(env);

	if (env.SELVA_PROVIDER === 'supabase') {
		const supabaseUrl = env.SUPABASE_URL;
		const anonKey = env.SUPABASE_ANON_KEY;
		const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
		if (!supabaseUrl) throw new Error('Missing required env var: SUPABASE_URL');
		if (!anonKey) throw new Error('Missing required env var: SUPABASE_ANON_KEY');
		if (!serviceRoleKey) throw new Error('Missing required env var: SUPABASE_SERVICE_ROLE_KEY');
		// Share one ClientBundle across every Supabase provider so they reuse
		// a single service-role client and per-request WeakMap cache. The audit
		// sink writes via the same bundle, persisting every domain event to
		// `audit_events` (Permissions.md §9).
		const bundle = supa.buildClientBundle({ supabaseUrl, anonKey, serviceRoleKey });
		const events = new supa.SupabaseEventSink(bundle);
		return {
			tenancy,
			flags,
			auth: supa.SupabaseAuthProvider.fromEnv(env),
			data: supa.SupabaseDataProvider.fromBundle(bundle, events),
			storage: supa.SupabaseStorageProvider.fromEnv(env),
			userProfile: new supa.SupabaseUserProfileProvider(bundle),
			permissions: new supa.SupabasePlatformPermissionStore(bundle)
		};
	}

	return {
		tenancy,
		flags,
		auth: local.LocalAuthProvider.fromEnv(env),
		data: local.LocalDataProvider.fromEnv(env),
		storage: local.LocalStorageProvider.fromEnv(env),
		userProfile: local.LocalUserProfileProvider.fromEnv(env),
		permissions: local.LocalPlatformPermissionStore.fromEnv(env)
	};
});
