import { test } from 'node:test';
import assert from 'node:assert/strict';
import { declaredDataFormat, verdict } from './downgrade-check.mjs';

const BROKEN_DOWNGRADE = [
	'downgrade: after boot: key of "seeded" server: threw: unencrypted apiKey'
];

test('passes when stable reads everything', () => {
	assert.equal(verdict({ problems: [], stableFormat: 2, newFormat: 2 }).pass, true);
});

test('fails a broken downgrade when both builds declare the same format', () => {
	const result = verdict({ problems: BROKEN_DOWNGRADE, stableFormat: 2, newFormat: 2 });
	assert.equal(result.pass, false);
	assert.match(result.summary, /bump DATA_FORMAT/);
	assert.deepEqual(result.problems, BROKEN_DOWNGRADE);
});

test('passes a broken downgrade this build declares with a higher format', () => {
	const result = verdict({ problems: BROKEN_DOWNGRADE, stableFormat: 1, newFormat: 2 });
	assert.equal(result.pass, true);
	assert.match(result.summary, /data format 1 → 2/);
});

test('fails a broken upgrade whatever the formats say', () => {
	const problems = ['upgrade: after boot: boot check failed: []', ...BROKEN_DOWNGRADE];
	const result = verdict({ problems, stableFormat: 1, newFormat: 2 });
	assert.equal(result.pass, false);
	assert.deepEqual(result.problems, [problems[0]]);
});

test('a package.json without the field is format 1', () => {
	assert.equal(declaredDataFormat({}), 1);
	assert.equal(declaredDataFormat({ selva: null }), 1);
	assert.equal(declaredDataFormat({ selva: { dataFormat: 'two' } }), 1);
	assert.equal(declaredDataFormat({ selva: { dataFormat: 3 } }), 3);
});
