// `selva migrate` rewrites a live .env on a customer's server. The rule it must
// hold: every setting means after the rewrite what it meant before.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEnv } from 'node:util';
import { planEnvMigration } from '../env-migration.js';

const KEYS = [
	'SELVA_HMAC_KEY=abababababababababababababababababababababababababababababababab',
	'SELVA_AT_REST_KEY=cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd'
].join('\n');

test('renames an old name, keeping its value', () => {
	const plan = planEnvMigration(`${KEYS}\nCOMPUTE_RESPONSE_CACHE_MB=45000\n`);
	assert.equal(parseEnv(plan.text).COMPUTE_SOLVE_CACHE_MB, '45000');
	assert.equal(parseEnv(plan.text).COMPUTE_RESPONSE_CACHE_MB, undefined);
	assert.deepEqual(plan.changes, [
		{ key: 'COMPUTE_RESPONSE_CACHE_MB', action: 'renamed', to: 'COMPUTE_SOLVE_CACHE_MB' }
	]);
	assert.deepEqual(plan.mismatches, []);
});

test('an old name beside its new name is dropped: the new one already won', () => {
	const plan = planEnvMigration(`${KEYS}\nCOMPUTE_RESPONSE_CACHE_MB=1\nCOMPUTE_SOLVE_CACHE_MB=2\n`);
	assert.equal(parseEnv(plan.text).COMPUTE_SOLVE_CACHE_MB, '2');
	assert.equal(parseEnv(plan.text).COMPUTE_RESPONSE_CACHE_MB, undefined);
});

test('rewrites a value to what the old, looser reader made of it', () => {
	// Old: only exactly "true" was on, so "1" was off. New: "1" is on. Rewrite to false.
	const plan = planEnvMigration(
		`${KEYS}\nSELVA_AUTH_PROVIDER=supabase\nSUPABASE_URL=https://x.supabase.co\nSUPABASE_ANON_KEY=a\nSUPABASE_SERVICE_ROLE_KEY=s\nSUPABASE_ENABLE_SELF_SIGNUP=1\nSUPABASE_ALLOW_EMAIL_LINK_SIGNUP=nope\n`
	);
	const env = parseEnv(plan.text);
	assert.equal(env.SUPABASE_ENABLE_SELF_SIGNUP, 'false');
	// Old: anything but "false" was on.
	assert.equal(env.SUPABASE_ALLOW_EMAIL_LINK_SIGNUP, 'true');
	assert.deepEqual(plan.mismatches, []);
});

test('replaces SELVA_FLAG_COMPUTE_DEBUG_VERBOSE with SELVA_FLAG_COMPUTE_DEBUG=verbose', () => {
	const plan = planEnvMigration(`${KEYS}\nSELVA_FLAG_COMPUTE_DEBUG_VERBOSE=true\n`);
	const env = parseEnv(plan.text);
	assert.equal(env.SELVA_FLAG_COMPUTE_DEBUG, 'verbose');
	assert.equal(env.SELVA_FLAG_COMPUTE_DEBUG_VERBOSE, undefined);
});

test('removes retired keys, whatever their value, and names what replaced them', () => {
	const plan = planEnvMigration(
		`${KEYS}\nCOMPUTE_RATE_LIMIT_WINDOW_MS=5000\nREMOTE_DEFINITION_CACHE_TTL_MS=1\n`
	);
	const env = parseEnv(plan.text);
	assert.equal(env.COMPUTE_RATE_LIMIT_WINDOW_MS, undefined);
	assert.equal(env.REMOTE_DEFINITION_CACHE_TTL_MS, undefined);
	assert.deepEqual(plan.changes, [
		{
			key: 'COMPUTE_RATE_LIMIT_WINDOW_MS',
			action: 'removed',
			reason: 'no longer read: fixed at 100 s'
		},
		{
			key: 'REMOTE_DEFINITION_CACHE_TTL_MS',
			action: 'removed',
			reason: 'no longer read: fixed at 5 min'
		}
	]);
	assert.deepEqual(plan.mismatches, []);
	assert.deepEqual(plan.unknown, []);
});

test('removes header names set to their defaults, which change nothing', () => {
	const plan = planEnvMigration(
		`${KEYS}\nSELVA_AUTH_PROVIDER=header\nDATA_PATH=/d\nHEADER_AUTH_DATA_DIR=/d\nHEADER_AUTH_UPN_HEADER=SELVA-UserPrincipalName\n`
	);
	const env = parseEnv(plan.text);
	assert.equal(env.HEADER_AUTH_UPN_HEADER, undefined);
	assert.equal(env.HEADER_AUTH_DATA_DIR, undefined);
	assert.equal(env.DATA_PATH, '/d');
});

test('keeps and reports a key it does not know, never deleting it', () => {
	const plan = planEnvMigration(`${KEYS}\nCOMPUTE_SOLVE_CACHE=5\nMY_OWN_THING=x\n`);
	const env = parseEnv(plan.text);
	assert.equal(env.COMPUTE_SOLVE_CACHE, '5');
	assert.equal(env.MY_OWN_THING, 'x');
	assert.deepEqual(plan.unknown, [
		{ key: 'COMPUTE_SOLVE_CACHE', suggestion: 'COMPUTE_SOLVE_CACHE_MB' }
	]);
});

test('keeps an operator note above a setting and strips shipped template prose', () => {
	const banner = ['# ' + '='.repeat(76), '# SHIPPED TEMPLATE', '# ' + '='.repeat(76)].join('\n');
	const plan = planEnvMigration(
		`${banner}\n\n${KEYS}\n# raised for the big model\nCOMPUTE_SOLVE_CACHE_MB=200000\n`
	);
	assert.doesNotMatch(plan.text, /SHIPPED TEMPLATE/);
	assert.match(plan.text, /# raised for the big model\nCOMPUTE_SOLVE_CACHE_MB=200000/);
});

test('an already current file plans no changes', () => {
	const text = `${KEYS}\nORIGIN=https://selva.example.com\n`;
	const plan = planEnvMigration(text);
	assert.deepEqual(plan.changes, []);
	assert.equal(plan.text, text);
});

test('a value the old reader shrugged off but the new one rejects is a blocker, not a pass', () => {
	// The old readBool fell back to off for "enabled"; a fail-closed flag now stops boot on it.
	const plan = planEnvMigration(
		`${KEYS}\nDATA_PATH=/d\nSELVA_FLAG_ENABLE_SHARING=enabled\nCOMPUTE_SOLVE_CACHE_MB=lots\n`
	);
	assert.deepEqual(
		plan.blockers.map((b) => b.key),
		['SELVA_FLAG_ENABLE_SHARING']
	);
	assert.deepEqual(
		plan.fallbacks.map((b) => b.key),
		['COMPUTE_SOLVE_CACHE_MB']
	);
});
