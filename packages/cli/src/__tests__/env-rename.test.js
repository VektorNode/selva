// `selva migrate` rewrites the operator's .env in place, so these pin the
// blast radius: only the key changes, and only on lines that are live config.
// Run by `pnpm test` via node's built-in runner.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renameEnvKeys, RENAMED_ENV_VARS, RETIRED_ENV_VARS } from '../env.js';

test('renames a deprecated key and leaves everything else byte-identical', () => {
	const before = [
		'# Selva deployment',
		'ORIGIN=https://example.com',
		'',
		'# Longest a solve may run.',
		'COMPUTE_RESPONSE_CACHE_MB=45000',
		'COMPUTE_RATE_LIMIT_MAX=120',
		''
	].join('\n');

	const { text, changes } = renameEnvKeys(before, RENAMED_ENV_VARS);

	assert.deepEqual(changes, [['COMPUTE_RESPONSE_CACHE_MB', 'COMPUTE_SOLVE_CACHE_MB', 'renamed']]);
	assert.equal(text, before.replace('COMPUTE_RESPONSE_CACHE_MB', 'COMPUTE_SOLVE_CACHE_MB'));
});

test('preserves the value verbatim, including quotes and spacing', () => {
	const { text } = renameEnvKeys(
		'COMPUTE_RESPONSE_CACHE_MB="512"\n   COMPUTE_DEFINITION_BYTE_CACHE_MB = 60000\n',
		RENAMED_ENV_VARS
	);
	assert.match(text, /^COMPUTE_SOLVE_CACHE_MB="512"$/m);
	assert.match(text, /^ {3}COMPUTE_DEFINITION_CACHE_MB = 60000$/m);
});

test('drops the old line when the new name is already set', () => {
	const { text, changes } = renameEnvKeys(
		'COMPUTE_RESPONSE_CACHE_MB=45000\nCOMPUTE_SOLVE_CACHE_MB=30000\n',
		RENAMED_ENV_VARS
	);
	// The server resolves the same way (new name wins), so keeping both would
	// preserve a line that does nothing.
	assert.deepEqual(changes, [['COMPUTE_RESPONSE_CACHE_MB', 'COMPUTE_SOLVE_CACHE_MB', 'dropped']]);
	assert.equal(text, 'COMPUTE_SOLVE_CACHE_MB=30000\n');
});

test('reports no changes for an already-current file', () => {
	const { changes } = renameEnvKeys('COMPUTE_SOLVE_CACHE_MB=30000\n', RENAMED_ENV_VARS);
	assert.deepEqual(changes, []);
});

test('ignores a commented-out old name — it is not active config', () => {
	const before = '# COMPUTE_RESPONSE_CACHE_MB=100000\n';
	const { text, changes } = renameEnvKeys(before, RENAMED_ENV_VARS);
	assert.deepEqual(changes, []);
	assert.equal(text, before);
});

test('leaves retired keys to the migration, which removes rather than renames them', () => {
	const before = 'SELVA_FLAG_COMPUTE_DEBUG_VERBOSE=true\n';
	const { text, changes } = renameEnvKeys(before, RENAMED_ENV_VARS);
	assert.deepEqual(changes, []);
	assert.equal(text, before);
	assert.ok(RETIRED_ENV_VARS.SELVA_FLAG_COMPUTE_DEBUG_VERBOSE);
});
