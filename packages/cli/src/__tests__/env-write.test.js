// The CLI rewrites an operator's live .env (keys rotate, init, migrate), and the
// app reads it with Node's own parser (`node --env-file`). Every case here reads
// the result back with `util.parseEnv`, the same parser, so a value that looks
// right in the file but boots wrong fails.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEnv as nodeParseEnv } from 'node:util';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setEnvValues, renderEnvValues, writeEnvText } from '../env.js';

const JWK = '{"kty":"EC","crv":"P-256","x":"a","y":"b","d":"c"}';

test('a JSON value survives a rewrite exactly as Node reads it', () => {
	const text = setEnvValues('ORIGIN=https://example.com\n', { SUPABASE_JWT_SIGNING_KEY: JWK });
	assert.equal(nodeParseEnv(text).SUPABASE_JWT_SIGNING_KEY, JWK);
});

test('values with spaces, hashes and both quote kinds round-trip', () => {
	const values = {
		SMTP_FROM: 'Selva <no-reply@example.com>',
		A: 'has # hash',
		B: `it's "quoted"`,
		C: 'plain'
	};
	const parsed = nodeParseEnv(setEnvValues('', values));
	for (const [key, value] of Object.entries(values)) assert.equal(parsed[key], value, key);
});

test('editing one key leaves every other line, comments included, byte-identical', () => {
	const before = [
		'# my note about the origin',
		'ORIGIN=https://example.com',
		'BODY_SIZE_LIMIT=256M # uploads',
		'SELVA_HMAC_KEY=old',
		''
	].join('\n');
	const after = setEnvValues(before, { SELVA_HMAC_KEY: 'new' });
	assert.equal(after, before.replace('SELVA_HMAC_KEY=old', 'SELVA_HMAC_KEY=new'));
	assert.equal(nodeParseEnv(after).BODY_SIZE_LIMIT, '256M');
});

test('a new key is appended; undefined removes a key', () => {
	const after = setEnvValues('A=1\nB=2\n', { C: '3', A: undefined });
	assert.deepEqual(nodeParseEnv(after), { B: '2', C: '3' });
	assert.ok(after.endsWith('\n'));
});

test('a file without a trailing newline does not glue the appended line on', () => {
	assert.deepEqual(nodeParseEnv(setEnvValues('A=1', { B: '2' })), { A: '1', B: '2' });
});

test('the scaffold renderer encodes values the same way', () => {
	const text = renderEnvValues('', { SUPABASE_JWT_SIGNING_KEY: JWK }, { header: '' });
	assert.equal(nodeParseEnv(text).SUPABASE_JWT_SIGNING_KEY, JWK);
});

test(
	'writeEnvText leaves the file readable by its owner only',
	{ skip: process.platform === 'win32' },
	() => {
		const path = join(mkdtempSync(join(tmpdir(), 'selva-env-')), '.env');
		writeFileSync(path, 'OLD=1\n', { mode: 0o644 });
		writeEnvText(path, 'A=1\n');
		assert.equal(statSync(path).mode & 0o777, 0o600);
		assert.equal(readFileSync(path, 'utf8'), 'A=1\n');
	}
);

test('a key set twice is edited where Node reads it, the last line, and the duplicate goes', () => {
	const after = setEnvValues('A=old\nB=1\nA=dup\n', { A: 'new' });
	assert.equal(nodeParseEnv(after).A, 'new');
	assert.equal(after, 'B=1\nA=new\n');
	assert.deepEqual(nodeParseEnv(setEnvValues('A=old\nA=dup\n', { A: undefined })), {});
});
