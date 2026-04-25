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

import { defineConfig, type SelvaFlags, type TenancyMode } from '@selva/platform/config';
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
		const data = supa.SupabaseDataProvider.fromEnv(env);
		// Share one ClientBundle across every Supabase provider so they reuse
		// a single service-role client and per-request WeakMap cache.
		const bundle = data.getClientBundle();
		return {
			tenancy,
			flags,
			auth: supa.SupabaseAuthProvider.fromEnv(env),
			data,
			storage: supa.SupabaseStorageProvider.fromEnv(env),
			userProfile: new supa.SupabaseUserProfileProvider(bundle)
		};
	}

	return {
		tenancy,
		flags,
		auth: local.LocalAuthProvider.fromEnv(env),
		data: local.LocalDataProvider.fromEnv(env),
		storage: local.LocalStorageProvider.fromEnv(env),
		userProfile: local.LocalUserProfileProvider.fromEnv(env)
	};
});
