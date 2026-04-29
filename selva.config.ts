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
	// Supabase data provider owns the ClientBundle; the audit query reuses it
	// so reads share the same service-role client as the event sink writes.
	const data = supa.SupabaseDataProvider.fromEnv(env);

	return {
		// ── Product decisions ─────────────────────────────────────────────────
		tenancy: 'single' as const,
		flags: {
			ALLOW_CROSS_ORG_PUBLIC: false,
			ALLOW_ORG_COMPUTE_OVERRIDE: false,
			ALLOW_ORG_CREATION: false
		},

		// ── Provider (switch this whole block to change backend) ──────────────
		// Local (no audit log — local-provider stays on NoopEventSink):
		// auth: local.LocalAuthProvider.fromEnv(env),
		// data: local.LocalDataProvider.fromEnv(env),
		// storage: local.LocalStorageProvider.fromEnv(env)

		// Supabase:
		auth: supa.SupabaseAuthProvider.fromEnv(env),
		data,
		storage: supa.SupabaseStorageProvider.fromEnv(env),
		auditQuery: new supa.SupabaseAuditQuery(data.getClientBundle())
	};
});
