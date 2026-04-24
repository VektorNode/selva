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

import { defineConfig, type TenancyMode } from '@selva/platform/config';
import * as local from 'selva-local-provider';
import * as supa from '@selva/supabase-provider';

function resolveTenancy(env: Record<string, string | undefined>): TenancyMode {
	return env.SELVA_TENANCY === 'multi' ? 'multi' : 'single';
}

export default defineConfig((env) => {
	const tenancy = resolveTenancy(env);

	if (env.SELVA_PROVIDER === 'supabase') {
		const data = supa.SupabaseDataProvider.fromEnv(env);
		// Share one ClientBundle across every Supabase provider so they reuse
		// a single service-role client and per-request WeakMap cache.
		const bundle = data.getClientBundle();
		return {
			tenancy,
			auth: supa.SupabaseAuthProvider.fromEnv(env),
			data,
			storage: supa.SupabaseStorageProvider.fromEnv(env),
			userProfile: new supa.SupabaseUserProfileProvider(bundle)
		};
	}

	return {
		tenancy,
		auth: local.LocalAuthProvider.fromEnv(env),
		data: local.LocalDataProvider.fromEnv(env),
		storage: local.LocalStorageProvider.fromEnv(env),
		userProfile: local.LocalUserProfileProvider.fromEnv(env)
	};
});
