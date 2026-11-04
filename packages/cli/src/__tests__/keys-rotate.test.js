// A routine rotation must not break anything the old key signed, so the old
// key moves to _PREVIOUS rather than disappearing, and is accepted for a
// bounded time: a rotation is meant to limit how long a leaked key stays useful.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEnv } from 'node:util';
import { setEnvValues } from '../env.js';
import { hmacBlastRadius, rotationUpdates } from '../commands/keys.js';

const before = 'SELVA_HMAC_KEY=old\nORIGIN=https://example.com\n';
const NOW = Date.parse('2026-11-03T12:00:00Z');

test('rotate keeps the old key as _PREVIOUS, accepted for 30 days', () => {
	const updates = rotationUpdates(parseEnv(before), 'SELVA_HMAC_KEY', 'rotate', 'new', NOW);
	assert.deepEqual(parseEnv(setEnvValues(before, updates)), {
		SELVA_HMAC_KEY: 'new',
		ORIGIN: 'https://example.com',
		SELVA_HMAC_KEY_PREVIOUS: 'old',
		SELVA_HMAC_KEY_PREVIOUS_EXPIRES: '2026-12-03T12:00:00.000Z'
	});
});

test('finish drops _PREVIOUS and its deadline', () => {
	const rotated = [
		'SELVA_HMAC_KEY=new',
		'SELVA_HMAC_KEY_PREVIOUS=old',
		'SELVA_HMAC_KEY_PREVIOUS_EXPIRES=2026-12-03T12:00:00.000Z',
		''
	].join('\n');
	const env = parseEnv(
		setEnvValues(rotated, rotationUpdates(parseEnv(rotated), 'SELVA_HMAC_KEY', 'finish'))
	);
	assert.deepEqual(env, { SELVA_HMAC_KEY: 'new' });
});

test('leaked replaces the key and keeps no previous', () => {
	const env = parseEnv(
		setEnvValues(before, rotationUpdates(parseEnv(before), 'SELVA_HMAC_KEY', 'leaked', 'new'))
	);
	assert.equal(env.SELVA_HMAC_KEY, 'new');
	assert.equal(env.SELVA_HMAC_KEY_PREVIOUS, undefined);
	assert.equal(env.SELVA_HMAC_KEY_PREVIOUS_EXPIRES, undefined);
});

test('the blast radius says "logs everyone out" only where the key signs sessions', () => {
	assert.match(hmacBlastRadius({}).join('\n'), /log every signed-in user out/);
	for (const auth of ['header', 'supabase']) {
		assert.doesNotMatch(hmacBlastRadius({ SELVA_AUTH_PROVIDER: auth }).join('\n'), /log every/);
	}
});
