// The runtime bundles the provider's code but not its SQL, so after `selva update`
// the database, the installed provider and the runtime can sit on three different
// heads. Doctor used to compare the database against the provider only: both
// stale, both equal, green, while the app answered /api/health with 503.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judgeMigrationHeads, providerTagFor } from '../checks/migrations.js';
import { degradedReason } from '../commands/pm2.js';

const OLD = '20261021120000';
const NEW = '20261101200000';

test('a database matching a stale provider is red when the runtime expects more', () => {
	const r = judgeMigrationHeads({
		runtime: NEW,
		provider: OLD,
		database: { head: OLD },
		tag: 'beta'
	});
	assert.equal(r.severity, 'red');
	assert.match(r.line, new RegExp(`behind the app's expected ${NEW}`));
	assert.match(r.line, /npm install --prefer-online @selvajs\/supabase-provider@beta/);
});

test('a behind database with a current provider skips the provider install', () => {
	const r = judgeMigrationHeads({
		runtime: NEW,
		provider: NEW,
		database: { head: OLD },
		tag: 'beta'
	});
	assert.equal(r.severity, 'red');
	assert.doesNotMatch(r.line, /npm install/);
	assert.match(r.line, /npx selva-supabase && npx supabase db push/);
});

test('a current database with a stale provider warns about the next upgrade', () => {
	const r = judgeMigrationHeads({
		runtime: NEW,
		provider: OLD,
		database: { head: NEW },
		tag: 'latest'
	});
	assert.equal(r.severity, 'yellow');
	assert.match(r.line, /supabase-provider@latest/);
});

test('everything aligned is green', () => {
	const r = judgeMigrationHeads({
		runtime: NEW,
		provider: NEW,
		database: { head: NEW },
		tag: 'beta'
	});
	assert.equal(r.severity, 'green');
});

test('a runtime without runtime-meta.json falls back to the provider head', () => {
	const r = judgeMigrationHeads({
		runtime: null,
		provider: OLD,
		database: { head: OLD },
		tag: 'latest'
	});
	assert.equal(r.severity, 'green');
	assert.match(r.line, /installed provider/);
});

test('an unreachable database is a warning, not a verdict', () => {
	const r = judgeMigrationHeads({
		runtime: NEW,
		provider: NEW,
		database: { error: 'fetch failed' },
		tag: 'beta'
	});
	assert.equal(r.severity, 'yellow');
});

test('the provider channel follows the runtime', () => {
	assert.equal(providerTagFor('4.20.0-beta.22'), 'beta');
	assert.equal(providerTagFor('4.19.0'), 'latest');
	assert.equal(providerTagFor(undefined), 'latest');
});

test('update names the schema skew a 503 reports', () => {
	const reason = degradedReason({
		status: 'degraded',
		boot: {
			atRestSecrets: { ok: true, failures: [], plaintextFound: false },
			schemaVersion: { ok: false, expected: NEW, actual: OLD, message: 'behind' }
		}
	});
	assert.equal(reason, 'behind');
	assert.match(degradedReason({ boot: { atRestSecrets: { ok: false } } }), /SELVA_AT_REST_KEY/);
});
