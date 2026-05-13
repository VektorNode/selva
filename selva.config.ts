/**
 * Selva provider wiring — the single DI point for auth / data / storage,
 * tenancy, and platform flags.
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
	return {
		tenancy: 'single' as const,
		flags: {
			ALLOW_CROSS_ORG_PUBLIC: false,
			ALLOW_ORG_COMPUTE_OVERRIDE: false,
			ALLOW_ORG_CREATION: false,
			ENABLE_SHARING: false
		},

		auth: local.LocalAuthProvider.fromEnv(env),
		data: local.LocalDataProvider.fromEnv(env),
		storage: local.LocalStorageProvider.fromEnv(env)
	};
});
