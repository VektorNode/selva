import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { ProviderError } from '@selvajs/platform';
import { createAllowlistStore, type AllowlistStore } from '../users.js';

let tempDir: string;
let filePath: string;
let store: AllowlistStore;

beforeEach(async () => {
	tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'selva-header-allowlist-test-'));
	filePath = path.join(tempDir, 'nested', 'header-allowlist.json');
	store = createAllowlistStore(filePath);
});

afterEach(async () => {
	await fs.rm(tempDir, { recursive: true, force: true });
});

describe('createAllowlistStore — reads', () => {
	it('returns empty list when the file does not exist', async () => {
		expect(await store.listUsers()).toEqual([]);
		expect(await store.findByUpn('anyone@example.com')).toBeNull();
		expect(await store.findById('does-not-exist')).toBeNull();
	});
});

describe('createAllowlistStore — UPN normalization', () => {
	it('stores the UPN case-folded and trimmed', async () => {
		const entry = await store.createUser('  Alice@Example.COM  ');
		expect(entry.upn).toBe('alice@example.com');
	});

	it('findByUpn matches regardless of caller casing or whitespace', async () => {
		await store.createUser('alice@example.com');
		expect((await store.findByUpn('ALICE@EXAMPLE.COM'))?.upn).toBe('alice@example.com');
		expect((await store.findByUpn('  alice@example.com  '))?.upn).toBe('alice@example.com');
	});

	it('refuses to create duplicates that differ only in case', async () => {
		await store.createUser('alice@example.com');
		await expect(store.createUser('ALICE@EXAMPLE.COM')).rejects.toBeInstanceOf(ProviderError);
		const all = await store.listUsers();
		expect(all).toHaveLength(1);
	});
});

describe('createAllowlistStore — materializeFromHeaders', () => {
	it('fills in empty fields on first sight', async () => {
		const created = await store.createUser('alice@example.com');
		await store.materializeFromHeaders(created.id, {
			email: 'alice@example.com',
			displayName: 'Alice Anderson'
		});
		const row = await store.findById(created.id);
		expect(row?.email).toBe('alice@example.com');
		expect(row?.displayName).toBe('Alice Anderson');
	});

	it('never overwrites an existing value (operator edits are sticky)', async () => {
		const created = await store.createUser('alice@example.com');
		// Simulate an operator-edited displayName by writing it directly via
		// the same materialize call once, then trying to clobber it.
		await store.materializeFromHeaders(created.id, {
			email: 'alice@example.com',
			displayName: 'Operator-Set Name'
		});
		await store.materializeFromHeaders(created.id, {
			email: 'attacker@elsewhere.com',
			displayName: 'Attacker Display'
		});
		const row = await store.findById(created.id);
		expect(row?.email).toBe('alice@example.com');
		expect(row?.displayName).toBe('Operator-Set Name');
	});

	it('does not write the file when there is nothing to fill', async () => {
		const created = await store.createUser('alice@example.com');
		await store.materializeFromHeaders(created.id, {
			email: 'alice@example.com',
			displayName: 'Alice'
		});
		const before = (await fs.stat(filePath)).mtimeMs;
		// Wait long enough for mtime to differ if a write happens (HFS+/APFS
		// resolution is 1ns, but some filesystems coalesce within 1ms).
		await new Promise((r) => setTimeout(r, 20));
		await store.materializeFromHeaders(created.id, {
			email: 'alice@example.com',
			displayName: 'Alice'
		});
		const after = (await fs.stat(filePath)).mtimeMs;
		expect(after).toBe(before);
	});
});

describe('createAllowlistStore — touchLastLogin (debounce)', () => {
	it('skips the write when called again within the debounce window', async () => {
		const created = await store.createUser('alice@example.com');
		await store.touchLastLogin(created.id);
		const first = (await store.findById(created.id))!.lastLoginAt!;
		await new Promise((r) => setTimeout(r, 20));
		await store.touchLastLogin(created.id);
		const second = (await store.findById(created.id))!.lastLoginAt!;
		expect(second).toBe(first);
	});

	it('refreshes when the prior timestamp is older than the debounce window', async () => {
		const created = await store.createUser('alice@example.com');
		// Hand-roll a stale timestamp (>60s old) directly to the file so we
		// don't have to wait a minute in CI.
		const raw = JSON.parse(await fs.readFile(filePath, 'utf-8'));
		raw.users[0].lastLoginAt = new Date(Date.now() - 5 * 60_000).toISOString();
		await fs.writeFile(filePath, JSON.stringify(raw, null, '\t'), 'utf-8');

		await store.touchLastLogin(created.id);
		const refreshed = (await store.findById(created.id))!.lastLoginAt!;
		expect(Date.parse(refreshed)).toBeGreaterThan(Date.now() - 60_000);
	});
});

describe('createAllowlistStore — durability', () => {
	it('survives a re-opened store on a fresh path', async () => {
		const a = await store.createUser('alice@example.com');
		await store.createUser('bob@example.com');
		const reopened = createAllowlistStore(filePath);
		const all = await reopened.listUsers();
		expect(all.map((u) => u.upn).sort()).toEqual(['alice@example.com', 'bob@example.com']);
		expect((await reopened.findById(a.id))?.upn).toBe('alice@example.com');
	});

	it('does not leave a .tmp file behind on a successful write', async () => {
		await store.createUser('alice@example.com');
		const siblings = await fs.readdir(path.dirname(filePath));
		expect(siblings.some((f) => f.endsWith('.tmp'))).toBe(false);
	});
});
