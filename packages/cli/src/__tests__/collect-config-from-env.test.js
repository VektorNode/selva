// `collectConfigFromEnv` is the unattended scaffold path (`--yes`, or `CI=1`).
// Nobody is watching a terminal when it runs, so a wrong default or a skipped
// validation doesn't surface as a prompt — it ships as a misconfigured
// deployment. These pin the defaults, the required-field errors, and the
// provider-dependent branches.
//
// Run by `pnpm test` via node's built-in runner.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectConfigFromEnv } from '../prompts.js';

const SUPABASE = {
	SUPABASE_URL: 'https://project.supabase.co',
	SUPABASE_ANON_KEY: 'sb_publishable_x',
	SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_x'
};

// ── Defaults ────────────────────────────────────────────────────────────

test('an empty environment scaffolds a single-tenant local deployment', () => {
	const v = collectConfigFromEnv({});
	assert.equal(v.SELVA_TENANCY, 'single');
	assert.equal(v.SELVA_AUTH_PROVIDER, 'local');
	assert.equal(v.SELVA_DATA_PROVIDER, 'local');
	assert.equal(v.SELVA_STORAGE_PROVIDER, 'local');
	assert.equal(v.DATA_PATH, './.selva-data');
	// Optional on a single-tenant local install — the first /setup visitor claims admin.
	assert.equal(v.BOOTSTRAP_INSTANCE_ADMIN_EMAIL, '');
	assert.equal(v.ORIGIN, '');
});

test('data and storage follow the auth provider unless set', () => {
	const v = collectConfigFromEnv({ SELVA_AUTH_PROVIDER: 'supabase', ...SUPABASE });
	assert.equal(v.SELVA_DATA_PROVIDER, 'supabase');
	assert.equal(v.SELVA_STORAGE_PROVIDER, 'supabase');
	// No local provider in play, so no DATA_PATH is written.
	assert.equal(v.DATA_PATH, undefined);
});

test('data and storage can be set independently of auth', () => {
	const v = collectConfigFromEnv({
		SELVA_AUTH_PROVIDER: 'supabase',
		SELVA_DATA_PROVIDER: 'local',
		SELVA_STORAGE_PROVIDER: 'local',
		...SUPABASE
	});
	assert.equal(v.SELVA_DATA_PROVIDER, 'local');
	assert.equal(v.SELVA_STORAGE_PROVIDER, 'local');
	assert.equal(v.DATA_PATH, './.selva-data', 'a local provider still needs DATA_PATH');
});

test('header-auth falls back to local data, not to header', () => {
	// Header-auth is an auth provider only — it has no data layer to inherit.
	const v = collectConfigFromEnv({
		SELVA_AUTH_PROVIDER: 'header',
		BOOTSTRAP_INSTANCE_ADMIN_EMAIL: 'admin@example.com'
	});
	assert.equal(v.SELVA_DATA_PROVIDER, 'local');
	assert.equal(v.SELVA_STORAGE_PROVIDER, 'local');
});

// ── Rejected values ─────────────────────────────────────────────────────

test('an unknown provider is rejected rather than silently defaulted', () => {
	assert.throws(
		() => collectConfigFromEnv({ SELVA_AUTH_PROVIDER: 'okta' }),
		/SELVA_AUTH_PROVIDER must be one of: local, supabase, header/
	);
	assert.throws(
		() => collectConfigFromEnv({ SELVA_DATA_PROVIDER: 'mongo' }),
		/SELVA_DATA_PROVIDER must be one of: local, supabase/
	);
	assert.throws(
		() => collectConfigFromEnv({ SELVA_STORAGE_PROVIDER: 's3' }),
		/SELVA_STORAGE_PROVIDER must be one of: local, supabase/
	);
	assert.throws(
		() => collectConfigFromEnv({ SELVA_TENANCY: 'many' }),
		/SELVA_TENANCY must be one of: single, multi/
	);
});

test('header is not accepted for data or storage', () => {
	// It has no data layer; accepting it would produce a deployment that
	// fails at boot instead of at scaffold time.
	assert.throws(() => collectConfigFromEnv({ SELVA_DATA_PROVIDER: 'header' }), /must be one of/);
	assert.throws(() => collectConfigFromEnv({ SELVA_STORAGE_PROVIDER: 'header' }), /must be one of/);
});

// ── Supabase ────────────────────────────────────────────────────────────

test('every Supabase credential is required when Supabase is in play', () => {
	for (const missing of Object.keys(SUPABASE)) {
		const env = { SELVA_AUTH_PROVIDER: 'supabase', ...SUPABASE };
		delete env[missing];
		assert.throws(
			() => collectConfigFromEnv(env),
			new RegExp(`${missing} is required`),
			`${missing} must be required`
		);
	}
});

test('Supabase credentials are required even when only storage uses Supabase', () => {
	assert.throws(
		() => collectConfigFromEnv({ SELVA_STORAGE_PROVIDER: 'supabase' }),
		/SUPABASE_URL is required/
	);
});

test('a malformed SUPABASE_URL is rejected', () => {
	assert.throws(
		() =>
			collectConfigFromEnv({ SELVA_AUTH_PROVIDER: 'supabase', ...SUPABASE, SUPABASE_URL: 'nope' }),
		/SUPABASE_URL must be a valid URL/
	);
});

// ── Bootstrap admin ─────────────────────────────────────────────────────

test('multi-tenant requires a bootstrap admin', () => {
	// Without it the FIRST person to sign in becomes Selva staff.
	assert.throws(
		() => collectConfigFromEnv({ SELVA_TENANCY: 'multi' }),
		/BOOTSTRAP_INSTANCE_ADMIN_EMAIL is required for multi-tenant/
	);
});

test('header-auth requires a bootstrap admin', () => {
	// Header-auth has no /setup form, so there is no other way to claim admin.
	assert.throws(
		() => collectConfigFromEnv({ SELVA_AUTH_PROVIDER: 'header' }),
		/BOOTSTRAP_INSTANCE_ADMIN_EMAIL is required for header-auth/
	);
});

test('a malformed admin email is rejected wherever it is optional', () => {
	assert.throws(
		() => collectConfigFromEnv({ BOOTSTRAP_INSTANCE_ADMIN_EMAIL: 'not-an-email' }),
		/is not a valid email/
	);
});

// ── ORIGIN ──────────────────────────────────────────────────────────────

test('ORIGIN is validated and must not carry a trailing slash', () => {
	assert.throws(() => collectConfigFromEnv({ ORIGIN: 'not a url' }), /ORIGIN must be a valid URL/);
	assert.throws(
		() => collectConfigFromEnv({ ORIGIN: 'https://example.com/' }),
		/ORIGIN must not have a trailing slash/
	);
	assert.equal(
		collectConfigFromEnv({ ORIGIN: 'https://example.com' }).ORIGIN,
		'https://example.com'
	);
});

// ── Header-auth specifics ───────────────────────────────────────────────

test('header-auth binds to loopback by default', () => {
	// The provider trusts identity headers, so anything that reaches the process
	// directly can spoof them.
	const v = collectConfigFromEnv({
		SELVA_AUTH_PROVIDER: 'header',
		BOOTSTRAP_INSTANCE_ADMIN_EMAIL: 'admin@example.com'
	});
	assert.equal(v.HOST, '127.0.0.1');
});

test('header-auth with a non-local data provider requires an explicit allowlist dir', () => {
	// There is no DATA_PATH to fall back to.
	assert.throws(
		() =>
			collectConfigFromEnv({
				SELVA_AUTH_PROVIDER: 'header',
				SELVA_DATA_PROVIDER: 'supabase',
				BOOTSTRAP_INSTANCE_ADMIN_EMAIL: 'admin@example.com',
				...SUPABASE
			}),
		/HEADER_AUTH_DATA_DIR is required/
	);
});

test('custom header names are passed through only when set', () => {
	const base = {
		SELVA_AUTH_PROVIDER: 'header',
		BOOTSTRAP_INSTANCE_ADMIN_EMAIL: 'admin@example.com'
	};
	assert.equal(collectConfigFromEnv(base).HEADER_AUTH_UPN_HEADER, undefined);

	const v = collectConfigFromEnv({ ...base, HEADER_AUTH_UPN_HEADER: 'X-Upn' });
	assert.equal(v.HEADER_AUTH_UPN_HEADER, 'X-Upn');
});

// ── Feature flags ───────────────────────────────────────────────────────

// Mirrors FLAG_KEYS in @selvajs/server's create-selva-providers.ts. A flag the
// CLI never writes cannot be enabled on an unattended install.
const FLAG_KEYS = [
	'ALLOW_CROSS_ORG_PUBLIC',
	'ALLOW_ORG_COMPUTE_OVERRIDE',
	'ALLOW_ORG_CREATION',
	'ENABLE_PLATFORM_PROJECTS',
	'ENABLE_SHARING'
];

test('every platform flag the server reads is written', () => {
	const v = collectConfigFromEnv({});
	for (const key of FLAG_KEYS) {
		assert.ok(`SELVA_FLAG_${key}` in v, `SELVA_FLAG_${key} must be written`);
	}
});

test('flags default to off', () => {
	const v = collectConfigFromEnv({});
	for (const key of FLAG_KEYS) {
		// The server's readBool treats '' as absent and falls back to false.
		assert.equal(v[`SELVA_FLAG_${key}`], '', `SELVA_FLAG_${key} must default to off`);
	}
});

test('flags accept the documented truthy spellings', () => {
	for (const raw of ['true', '1', 'yes', 'TRUE', 'Yes']) {
		const v = collectConfigFromEnv({ SELVA_FLAG_ENABLE_SHARING: raw });
		assert.equal(v.SELVA_FLAG_ENABLE_SHARING, 'true', `"${raw}" should enable the flag`);
	}
});

test('an unrecognised flag value is off, not on', () => {
	// Fail closed: these gate cross-org visibility and anonymous share links.
	for (const raw of ['false', '0', 'no', 'off', '', 'maybe']) {
		const v = collectConfigFromEnv({ SELVA_FLAG_ENABLE_SHARING: raw });
		assert.equal(v.SELVA_FLAG_ENABLE_SHARING, '', `"${raw}" must not enable the flag`);
	}
});

test('one flag being set does not enable the others', () => {
	const v = collectConfigFromEnv({ SELVA_FLAG_ENABLE_SHARING: 'true' });
	assert.equal(v.SELVA_FLAG_ENABLE_SHARING, 'true');
	assert.equal(v.SELVA_FLAG_ALLOW_ORG_CREATION, '');
	assert.equal(v.SELVA_FLAG_ALLOW_CROSS_ORG_PUBLIC, '');
});
