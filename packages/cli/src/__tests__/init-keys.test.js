// `selva init` runs against a live deployment. Replacing a working root key
// there logs every user out (SELVA_HMAC_KEY) or makes every stored compute API
// key unreadable (SELVA_AT_REST_KEY), so init may only fill a key that is
// missing or still the template's placeholder.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rootKeysFor } from '../commands/init.js';

const PLACEHOLDER = 'replace-this-with-a-random-32-byte-hex-key';
const HMAC = 'a'.repeat(64);
const AT_REST = 'b'.repeat(64);
const fresh = () => 'fresh-key';

test('keeps both keys a deployment already has', () => {
	const { keys, generated } = rootKeysFor(
		{ SELVA_HMAC_KEY: HMAC, SELVA_AT_REST_KEY: AT_REST },
		fresh
	);
	assert.deepEqual(keys, { SELVA_HMAC_KEY: HMAC, SELVA_AT_REST_KEY: AT_REST });
	assert.deepEqual(generated, []);
});

for (const name of ['SELVA_HMAC_KEY', 'SELVA_AT_REST_KEY']) {
	const other = name === 'SELVA_HMAC_KEY' ? 'SELVA_AT_REST_KEY' : 'SELVA_HMAC_KEY';
	const existing = { SELVA_HMAC_KEY: HMAC, SELVA_AT_REST_KEY: AT_REST };

	test(`replaces ${name} when it is still the placeholder, and keeps the other`, () => {
		const { keys, generated } = rootKeysFor({ ...existing, [name]: PLACEHOLDER }, fresh);
		assert.equal(keys[name], 'fresh-key');
		assert.equal(keys[other], existing[other]);
		assert.deepEqual(generated, [name]);
	});

	for (const [label, value] of [
		['missing', undefined],
		['blank', '']
	]) {
		test(`generates ${name} when it is ${label}, and keeps the other`, () => {
			const { keys, generated } = rootKeysFor({ ...existing, [name]: value }, fresh);
			assert.equal(keys[name], 'fresh-key');
			assert.equal(keys[other], existing[other]);
			assert.deepEqual(generated, [name]);
		});
	}
}

test('a generated key is a real one, not the placeholder', () => {
	const { keys } = rootKeysFor({});
	assert.match(keys.SELVA_HMAC_KEY, /^[0-9a-f]{64}$/);
	assert.match(keys.SELVA_AT_REST_KEY, /^[0-9a-f]{64}$/);
	assert.notEqual(keys.SELVA_HMAC_KEY, keys.SELVA_AT_REST_KEY);
});
