// The previous key's deadline is what bounds a rotation; doctor says where it stands.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkKeyRotation } from '../checks/config.js';

const NOW = Date.parse('2026-11-03T12:00:00Z');

test('nothing to report without a previous key', () => {
	assert.deepEqual(checkKeyRotation({}, NOW), []);
});

test('an active overlap counts down', () => {
	const [r] = checkKeyRotation(
		{ SELVA_HMAC_KEY_PREVIOUS: 'old', SELVA_HMAC_KEY_PREVIOUS_EXPIRES: '2026-11-13T12:00:00Z' },
		NOW
	);
	assert.equal(r.severity, 'green');
	assert.match(r.line, /10 more days/);
});

test('a passed deadline and a missing one are both flagged', () => {
	const [expired] = checkKeyRotation(
		{
			SELVA_AT_REST_KEY_PREVIOUS: 'old',
			SELVA_AT_REST_KEY_PREVIOUS_EXPIRES: '2026-11-01T00:00:00Z'
		},
		NOW
	);
	assert.equal(expired.severity, 'yellow');
	assert.match(expired.line, /no longer accepted/);

	const [forever] = checkKeyRotation({ SELVA_HMAC_KEY_PREVIOUS: 'old' }, NOW);
	assert.equal(forever.severity, 'yellow');
	assert.match(forever.line, /no deadline/);
});
