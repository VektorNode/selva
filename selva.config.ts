/**
 * Selva provider wiring — the single DI point for auth / data / storage /
 * userProfile, tenancy, and platform flags.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  What belongs here vs in .env                                           │
 * │                                                                         │
 * │  selva.config.ts  — intentional product decisions: flags, tenancy,      │
 * │                     provider choice. Committed, reviewed in PRs,        │
 * │                     auditable in git history.                           │
 * │                                                                         │
 * │  .env             — deployment secrets and per-environment overrides:   │
 * │                     keys, URLs, credentials. Never committed.           │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Provider env vars: packages/compute-app/.env.example (authoritative ref)
 * Setup guide:       docs/QuickStart.md
 */

import { defineConfig } from '@selvajs/platform';
import * as local from '@selvajs/local-provider';
import * as supa from '@selvajs/supabase-provider';

export default defineConfig((env) => {
	// ── Product decisions (commit these, review them in PRs) ──────────────
	const tenancy = 'single';
	const flags = {
		ALLOW_CROSS_ORG_PUBLIC: false,
		ALLOW_ORG_COMPUTE_OVERRIDE: false,
		ALLOW_ORG_CREATION: false
	};

	// ── Provider selection (env-driven: secrets stay out of source) ───────
	if (env.SELVA_PROVIDER === 'supabase') {
		const supabaseUrl = env.SUPABASE_URL;
		const anonKey = env.SUPABASE_ANON_KEY;
		const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
		if (!supabaseUrl) throw new Error('Missing required env var: SUPABASE_URL');
		if (!anonKey) throw new Error('Missing required env var: SUPABASE_ANON_KEY');
		if (!serviceRoleKey) throw new Error('Missing required env var: SUPABASE_SERVICE_ROLE_KEY');
		// Share one ClientBundle so all providers reuse a single service-role
		// client and per-request WeakMap cache. The audit sink persists every
		// domain event to `audit_events` (Permissions.md §9).
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
