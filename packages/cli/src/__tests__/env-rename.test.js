// `selva migrate` rewrites the operator's .env in place, so these pin the
// blast radius: only the key changes, and only on lines that are live config.
// Run by `pnpm test` via node's built-in runner.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renameEnvKeys, RENAMED_ENV_VARS, REPLACED_ENV_VARS } from '../env.js';

test('renames a deprecated key and leaves everything else byte-identical', () => {
	const before = [
		'# Selva deployment',
		'ORIGIN=https://example.com',
		'',
		'# Longest a solve may run.',
		'MAX_SOLVE_DURATION_MS=45000',
		'COMPUTE_RATE_LIMIT_MAX=120',
		''
	].join('\n');

	const { text, changes } = renameEnvKeys(before, RENAMED_ENV_VARS);

	assert.deepEqual(changes, [['MAX_SOLVE_DURATION_MS', 'COMPUTE_SOLVE_DEADLINE_MS', 'renamed']]);
	assert.equal(text, before.replace('MAX_SOLVE_DURATION_MS', 'COMPUTE_SOLVE_DEADLINE_MS'));
});

test('preserves the value verbatim, including quotes and spacing', () => {
	const { text } = renameEnvKeys(
		'COMPUTE_RESPONSE_CACHE_MB="512"\n   DEFINITION_CACHE_TTL_MS = 60000\n',
		RENAMED_ENV_VARS
	);
	assert.match(text, /^COMPUTE_SOLVE_CACHE_MB="512"$/m);
	assert.match(text, /^ {3}REMOTE_DEFINITION_CACHE_TTL_MS = 60000$/m);
});

test('drops the old line when the new name is already set', () => {
	const { text, changes } = renameEnvKeys(
		'MAX_SOLVE_DURATION_MS=45000\nCOMPUTE_SOLVE_DEADLINE_MS=30000\n',
		RENAMED_ENV_VARS
	);
	// The server resolves the same way (new name wins), so keeping both would
	// preserve a line that does nothing.
	assert.deepEqual(changes, [['MAX_SOLVE_DURATION_MS', 'COMPUTE_SOLVE_DEADLINE_MS', 'dropped']]);
	assert.equal(text, 'COMPUTE_SOLVE_DEADLINE_MS=30000\n');
});

test('reports no changes for an already-current file', () => {
	const { changes } = renameEnvKeys('COMPUTE_SOLVE_DEADLINE_MS=30000\n', RENAMED_ENV_VARS);
	assert.deepEqual(changes, []);
});

test('ignores a commented-out old name — it is not active config', () => {
	const before = '# MAX_SOLVE_DURATION_MS=100000\n';
	const { text, changes } = renameEnvKeys(before, RENAMED_ENV_VARS);
	assert.deepEqual(changes, []);
	assert.equal(text, before);
});

test('leaves value-changing replacements alone — migrate must not guess', () => {
	const before = 'SELVA_FLAG_COMPUTE_DEBUG_VERBOSE=true\n';
	const { text, changes } = renameEnvKeys(before, RENAMED_ENV_VARS);
	assert.deepEqual(changes, []);
	assert.equal(text, before);
	// It is still reported by `selva doctor`, just not auto-fixed.
	assert.ok(REPLACED_ENV_VARS.SELVA_FLAG_COMPUTE_DEBUG_VERBOSE);
});
