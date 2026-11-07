// `selva config set|unset` edits a live deployment's .env. Each case runs the
// real command in a scratch deployment and checks what is on disk afterwards:
// the edit, the backup, and that a refused command wrote nothing at all.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BACKUP_PATTERN } from '../commands/migrate.js';

const SELVA = fileURLToPath(new URL('../../bin/selva.js', import.meta.url));
const HMAC = 'a'.repeat(64);
const AT_REST = 'b'.repeat(64);

function deployment(env) {
	const dir = mkdtempSync(join(tmpdir(), 'selva-config-'));
	writeFileSync(join(dir, '.env'), env, { mode: 0o644 });
	return dir;
}

function config(dir, ...args) {
	return spawnSync(process.execPath, [SELVA, 'config', ...args], {
		cwd: dir,
		encoding: 'utf8',
		env: { ...process.env, NO_COLOR: '1' }
	});
}

const envOf = (dir) => readFileSync(join(dir, '.env'), 'utf8');
const backupsOf = (dir) => readdirSync(dir).filter((f) => BACKUP_PATTERN.test(f));

const BEFORE = [
	'# where the app is served',
	'ORIGIN=https://old.example.com',
	`SELVA_HMAC_KEY=${HMAC}`,
	`SELVA_AT_REST_KEY=${AT_REST}`,
	'LOG_LEVEL=info',
	''
].join('\n');

test('set edits only its own line and keeps the previous file as a backup', () => {
	const dir = deployment(BEFORE);
	const r = config(dir, 'set', 'LOG_LEVEL=debug');
	assert.equal(r.status, 0, r.stderr);
	assert.equal(envOf(dir), BEFORE.replace('LOG_LEVEL=info', 'LOG_LEVEL=debug'));
	const backups = backupsOf(dir);
	assert.equal(backups.length, 1);
	assert.equal(readFileSync(join(dir, backups[0]), 'utf8'), BEFORE);
});

test(
	'the backup holds both root keys, so only the owner can read it',
	{ skip: process.platform === 'win32' },
	() => {
		const dir = deployment(BEFORE);
		assert.equal(config(dir, 'set', 'LOG_LEVEL=debug').status, 0);
		const [backup] = backupsOf(dir);
		assert.equal(statSync(join(dir, backup)).mode & 0o777, 0o600);
		assert.equal(statSync(join(dir, '.env')).mode & 0o777, 0o600);
	}
);

for (const [key, target] of [
	['SELVA_HMAC_KEY', 'hmac'],
	['SELVA_AT_REST_KEY', 'at-rest']
]) {
	test(`set refuses ${key}, which only \`keys rotate ${target}\` may replace`, () => {
		const dir = deployment(BEFORE);
		const r = config(dir, 'set', `${key}=${'c'.repeat(64)}`);
		assert.equal(r.status, 1);
		assert.match(r.stderr, new RegExp(`selva keys rotate ${target}`));
		assert.equal(envOf(dir), BEFORE);
		assert.deepEqual(backupsOf(dir), []);
	});

	test(`unset refuses ${key}: the app would not start without it`, () => {
		const dir = deployment(BEFORE);
		const r = config(dir, 'unset', key);
		assert.equal(r.status, 1);
		assert.match(r.stderr, /required/);
		assert.equal(envOf(dir), BEFORE);
		assert.deepEqual(backupsOf(dir), []);
	});
}

test('set refuses a value the app would reject, and writes nothing', () => {
	const dir = deployment(BEFORE);
	const r = config(dir, 'set', 'ORIGIN=not a url');
	assert.equal(r.status, 1);
	assert.equal(envOf(dir), BEFORE);
	assert.deepEqual(backupsOf(dir), []);
});

test('set refuses an old name, so the new one is not shadowed by a stale line', () => {
	const dir = deployment(BEFORE);
	const r = config(dir, 'set', 'COMPUTE_RESPONSE_CACHE_MB=64');
	assert.equal(r.status, 1);
	assert.match(r.stderr, /was renamed to/);
	assert.equal(envOf(dir), BEFORE);
});

test('unset removes only its own line, with a backup', () => {
	const dir = deployment(BEFORE);
	const r = config(dir, 'unset', 'LOG_LEVEL');
	assert.equal(r.status, 0, r.stderr);
	assert.equal(envOf(dir), BEFORE.replace('LOG_LEVEL=info\n', ''));
	const [backup] = backupsOf(dir);
	assert.equal(readFileSync(join(dir, backup), 'utf8'), BEFORE);
});

test('unset of a key .env does not set writes nothing', () => {
	const dir = deployment(BEFORE);
	assert.equal(config(dir, 'unset', 'BODY_SIZE_LIMIT').status, 0);
	assert.equal(envOf(dir), BEFORE);
	assert.deepEqual(backupsOf(dir), []);
});
