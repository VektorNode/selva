/**
 * Selva provider wiring.
 *
 * Switches the backend between the filesystem/JSON-based local provider and
 * the Supabase provider based on the `SELVA_PROVIDER` env var:
 *
 *   SELVA_PROVIDER=local      (default)  — local JSON + filesystem storage
 *   SELVA_PROVIDER=supabase              — Supabase Auth + Postgres + Storage
 *
 * Tenancy:
 *   SELVA_TENANCY=single   (default)  — one org per deployment
 *   SELVA_TENANCY=multi               — orgs are first-class, created post-setup
 *
 * Platform feature flags (all default to false / off):
 *   ALLOW_CROSS_ORG_PUBLIC=true          — `public` projects visible across orgs
 *   ALLOW_ORG_COMPUTE_OVERRIDE=true      — orgs can BYO their own Rhino.Compute
 *   ALLOW_ORG_CREATION=true              — authenticated users can create orgs
 *
 * Local provider env vars:
 *   DATA_PATH         — where users.json, orgs/projects/definitions JSON etc. live
 *   SESSION_SECRET    — HMAC secret for local session tokens
 *   (optional) ADMIN_PASSWORD — single-password fallback mode
 *
 * Supabase provider env vars:
 *   SUPABASE_URL                  — project URL (local: http://127.0.0.1:54321)
 *   SUPABASE_ANON_KEY             — "Publishable" key (sb_publishable_… on v2.95+)
 *   SUPABASE_SERVICE_ROLE_KEY     — "Secret" key (sb_secret_… on v2.95+)
 *   (optional) SUPABASE_PUBLIC_BUCKET, SUPABASE_PRIVATE_BUCKET, SUPABASE_PRIVATE_URL_PREFIX
 *   (optional) SUPABASE_ENABLE_SELF_SIGNUP=true
 *
 * See packages/supabase-provider/README.md for full deployment guide.
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
