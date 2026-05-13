/**
 * Selva provider wiring — the single DI point for auth / data / storage,
 * tenancy, and platform flags.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  White-label deployments should not need to touch this file.            │
 * │  Provider choice, tenancy mode, and flags are read from environment     │
 * │  variables (see .env.example). Fork this file only when wiring a        │
 * │  custom provider that isn't shipped in the repo.                        │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Env vars consumed here:
 *   SELVA_AUTH_PROVIDER          local | supabase | header   (default: local)
 *   SELVA_DATA_PROVIDER          local | supabase            (default: local)
 *   SELVA_STORAGE_PROVIDER       local | supabase            (default: local)
 *   SELVA_TENANCY                single | multi              (default: single)
 *   SELVA_FLAG_ALLOW_CROSS_ORG_PUBLIC      true | false      (default: false)
 *   SELVA_FLAG_ALLOW_ORG_COMPUTE_OVERRIDE  true | false      (default: false)
 *   SELVA_FLAG_ALLOW_ORG_CREATION          true | false      (default: false)
 *   SELVA_FLAG_ENABLE_SHARING              true | false      (default: false)
 *   SELVA_BRAND_NAME             product name in header / titles
 *   SELVA_BRAND_COPYRIGHT_NAME   footer copyright owner (defaults to name)
 *   SELVA_BRAND_TAGLINE          landing-page tagline
 *   SELVA_BRAND_DESCRIPTION      meta description for SEO / social
 *
 * Provider-specific env vars: packages/selva/.env.example
 * Setup guide:                docs/QuickStart.md
 */

import { defineConfig, type TenancyMode } from '@selvajs/platform';
import type { IAuthProvider } from '@selvajs/platform';
import type { IDataProvider } from '@selvajs/platform';
import type { IStorageProvider } from '@selvajs/platform';
import * as local from '@selvajs/local-provider';
import * as supa from '@selvajs/supabase-provider';
import * as header from '@selvajs/header-auth-provider';

type Env = Record<string, string | undefined>;

function envBool(env: Env, key: string): boolean {
	const v = env[key]?.toLowerCase();
	return v === 'true' || v === '1' || v === 'yes';
}

function pickAuth(env: Env): IAuthProvider {
	const choice = (env.SELVA_AUTH_PROVIDER ?? 'local').toLowerCase();
	switch (choice) {
		case 'local':
			return local.LocalAuthProvider.fromEnv(env);
		case 'supabase':
			return supa.SupabaseAuthProvider.fromEnv(env);
		case 'header':
			return header.HeaderAuthProvider.fromEnv(env);
		default:
			throw new Error(
				`Unknown SELVA_AUTH_PROVIDER="${choice}". Expected: local | supabase | header.`
			);
	}
}

function pickData(env: Env): IDataProvider {
	const choice = (env.SELVA_DATA_PROVIDER ?? 'local').toLowerCase();
	switch (choice) {
		case 'local':
			return local.LocalDataProvider.fromEnv(env);
		case 'supabase':
			return supa.SupabaseDataProvider.fromEnv(env);
		default:
			throw new Error(
				`Unknown SELVA_DATA_PROVIDER="${choice}". Expected: local | supabase.`
			);
	}
}

function pickStorage(env: Env): IStorageProvider {
	const choice = (env.SELVA_STORAGE_PROVIDER ?? 'local').toLowerCase();
	switch (choice) {
		case 'local':
			return local.LocalStorageProvider.fromEnv(env);
		case 'supabase':
			return supa.SupabaseStorageProvider.fromEnv(env);
		default:
			throw new Error(
				`Unknown SELVA_STORAGE_PROVIDER="${choice}". Expected: local | supabase.`
			);
	}
}

function pickTenancy(env: Env): TenancyMode {
	const choice = (env.SELVA_TENANCY ?? 'single').toLowerCase();
	if (choice !== 'single' && choice !== 'multi') {
		throw new Error(`Unknown SELVA_TENANCY="${choice}". Expected: single | multi.`);
	}
	return choice;
}

export default defineConfig((env) => ({
	tenancy: pickTenancy(env),
	flags: {
		ALLOW_CROSS_ORG_PUBLIC: envBool(env, 'SELVA_FLAG_ALLOW_CROSS_ORG_PUBLIC'),
		ALLOW_ORG_COMPUTE_OVERRIDE: envBool(env, 'SELVA_FLAG_ALLOW_ORG_COMPUTE_OVERRIDE'),
		ALLOW_ORG_CREATION: envBool(env, 'SELVA_FLAG_ALLOW_ORG_CREATION'),
		ENABLE_SHARING: envBool(env, 'SELVA_FLAG_ENABLE_SHARING')
	},
	branding: {
		name: env.SELVA_BRAND_NAME,
		copyrightName: env.SELVA_BRAND_COPYRIGHT_NAME,
		tagline: env.SELVA_BRAND_TAGLINE,
		description: env.SELVA_BRAND_DESCRIPTION
	},
	auth: pickAuth(env),
	data: pickData(env),
	storage: pickStorage(env)
}));
