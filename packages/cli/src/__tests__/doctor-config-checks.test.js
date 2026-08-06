// The `.env`-only half of `selva doctor`. These decide whether a deployment is
// validly configured, and they used to be inlined in `runDoctor` — reachable
// only by running the whole command against a real directory, so nothing
// covered them.
//
// Run by `pnpm test` via node's built-in runner.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	checkDeprecatedEnv,
	checkOrigin,
	checkProviders,
	checkTenancy,
	resolveProviders
} from '../checks/config.js';
import { RENAMED_ENV_VARS, REPLACED_ENV_VARS } from '../env.js';

// ── Providers ───────────────────────────────────────────────────────────

test('providers default to local and are lowercased', () => {
	assert.deepEqual(resolveProviders({}), { auth: 'local', data: 'local', storage: 'local' });
	// Operators hand-edit .env; the runtime lowercases too, so doctor must agree
	// or it reports a working deployment as broken.
	assert.deepEqual(resolveProviders({ SELVA_AUTH_PROVIDER: 'Supabase' }).auth, 'supabase');
});

test('a valid provider set produces no complaints', () => {
	assert.deepEqual(checkProviders({ auth: 'local', data: 'local', storage: 'local' }), []);
	assert.deepEqual(checkProviders({ auth: 'supabase', data: 'supabase', storage: 'supabase' }), []);
	assert.deepEqual(checkProviders({ auth: 'header', data: 'local', storage: 'local' }), []);
});

test('header is rejected for data and storage but accepted for auth', () => {
	// Header-auth has no data layer. Accepting it here would let a deployment
	// scaffold and then fail at boot.
	const checks = checkProviders({ auth: 'header', data: 'header', storage: 'header' });
	assert.equal(checks.length, 2);
	assert.ok(checks.every((c) => c.severity === 'red'));
	assert.match(checks[0].line, /SELVA_DATA_PROVIDER/);
	assert.match(checks[1].line, /SELVA_STORAGE_PROVIDER/);
});

test('an unknown provider is reported per slot', () => {
	const checks = checkProviders({ auth: 'okta', data: 'mongo', storage: 's3' });
	assert.equal(checks.length, 3);
	assert.ok(checks.every((c) => c.severity === 'red'));
	assert.match(checks[0].line, /SELVA_AUTH_PROVIDER="okta"/);
});

// ── Tenancy ─────────────────────────────────────────────────────────────

test('tenancy defaults to single and accepts multi', () => {
	assert.equal(checkTenancy({}).severity, 'green');
	assert.match(checkTenancy({}).line, /single/);
	assert.equal(checkTenancy({ SELVA_TENANCY: 'multi' }).severity, 'green');
	assert.equal(checkTenancy({ SELVA_TENANCY: 'MULTI' }).severity, 'green');
});

test('an unknown tenancy is a failure', () => {
	const r = checkTenancy({ SELVA_TENANCY: 'many' });
	assert.equal(r.severity, 'red');
	assert.match(r.line, /expected single\|multi/);
});

// ── ORIGIN ──────────────────────────────────────────────────────────────

test('a missing ORIGIN warns but does not fail', () => {
	// Valid for a localhost install; only wrong behind a proxy, which doctor
	// cannot detect from .env alone.
	const r = checkOrigin({});
	assert.equal(r.severity, 'yellow');
});

test('a malformed ORIGIN is a failure', () => {
	assert.equal(checkOrigin({ ORIGIN: 'not a url' }).severity, 'red');
	assert.equal(checkOrigin({ ORIGIN: 'example.com' }).severity, 'red');
});

test('a well-formed ORIGIN passes', () => {
	const r = checkOrigin({ ORIGIN: 'https://example.com' });
	assert.equal(r.severity, 'green');
	assert.match(r.line, /https:\/\/example\.com/);
});

// ── Deprecated env vars ─────────────────────────────────────────────────

test('a current .env reports nothing deprecated', () => {
	assert.deepEqual(checkDeprecatedEnv({}), []);
	assert.deepEqual(checkDeprecatedEnv({ ORIGIN: 'https://example.com' }), []);
});

test('every renamed var is reported, and points at its replacement', () => {
	for (const [oldName, newName] of Object.entries(RENAMED_ENV_VARS)) {
		const checks = checkDeprecatedEnv({ [oldName]: '1' });
		assert.equal(checks.length, 1, `${oldName} should be reported`);
		assert.equal(checks[0].severity, 'yellow', 'a rename is fixable, so it must not fail the run');
		assert.match(checks[0].line, new RegExp(newName));
		assert.match(checks[0].line, /selva migrate/);
	}
});

test('a renamed var whose replacement is already set says the old one is ignored', () => {
	// Both present: the server resolves to the new name, so the old line is
	// dead config. Telling the operator to migrate would be misleading.
	const [oldName, newName] = Object.entries(RENAMED_ENV_VARS)[0];
	const checks = checkDeprecatedEnv({ [oldName]: '1', [newName]: '2' });
	assert.equal(checks.length, 1);
	assert.match(checks[0].line, /ignored/);
	assert.match(checks[0].line, new RegExp(`${newName} is set and wins`));
});

test('every replaced var is reported with its replacement value', () => {
	// These encode a value in the new name, so `selva migrate` will not guess —
	// doctor is the only place an operator hears about them.
	for (const [oldName, replacement] of Object.entries(REPLACED_ENV_VARS)) {
		const checks = checkDeprecatedEnv({ [oldName]: 'true' });
		assert.equal(checks.length, 1, `${oldName} should be reported`);
		assert.equal(checks[0].severity, 'yellow');
		assert.ok(
			checks[0].line.includes(replacement),
			`${oldName} should name its replacement "${replacement}"`
		);
		assert.ok(!checks[0].line.includes('selva migrate'), 'must not promise an automatic fix');
	}
});

test('deprecated vars are reported together, not just the first', () => {
	const renamed = Object.keys(RENAMED_ENV_VARS);
	const replaced = Object.keys(REPLACED_ENV_VARS);
	const env = {};
	for (const k of [...renamed, ...replaced]) env[k] = '1';
	assert.equal(checkDeprecatedEnv(env).length, renamed.length + replaced.length);
});
