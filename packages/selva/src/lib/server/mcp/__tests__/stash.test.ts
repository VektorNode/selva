import { describe, expect, it } from 'vitest';
import { createStash, STASH_TTL_MS } from '../stash.js';

function memoryStorage() {
	const files = new Map<string, Uint8Array>();
	return {
		files,
		get: async (path: string) => files.get(path) ?? null,
		put: async (path: string, data: Uint8Array) => {
			files.set(path, data);
			return path;
		},
		deletePrefix: async (prefix: string) => {
			for (const key of [...files.keys()]) if (key.startsWith(prefix)) files.delete(key);
		}
	};
}

const HOUR = 60 * 60_000;
const entry = { kind: 'file' as const, name: 'a.3dm', contentType: 'x', data: new Uint8Array([1]) };

describe('the MCP stash', () => {
	it('returns an entry of the right kind until it expires', async () => {
		let now = 100 * HOUR;
		const stash = createStash(memoryStorage(), () => now);
		const token = await stash.put(entry);
		expect((await stash.get(token, 'file'))?.data).toEqual(new Uint8Array([1]));
		expect(await stash.get(token, 'preview')).toBeUndefined();
		now += STASH_TTL_MS;
		expect(await stash.get(token, 'file')).toBeUndefined();
	});

	it('reads what another instance on the same storage wrote', async () => {
		const storage = memoryStorage();
		const token = await createStash(storage).put(entry);
		expect(await createStash(storage).get(token, 'file')).toBeDefined();
	});

	it('refuses tokens that are not its own shape, so a path never reaches storage', async () => {
		const stash = createStash(memoryStorage());
		expect(await stash.get('../../definitions/x', 'file')).toBeUndefined();
	});

	it('deletes hours two behind the current one, and keeps the rest', async () => {
		const storage = memoryStorage();
		let now = 100 * HOUR + 1;
		const stash = createStash(storage, () => now);
		const old = await stash.put(entry);
		now = 101 * HOUR + 1;
		const recent = await stash.put(entry);
		now = 102 * HOUR + 1;
		await stash.put(entry);
		await new Promise((r) => setTimeout(r, 0));
		expect([...storage.files.keys()].some((k) => k.startsWith('mcp-stash/100/'))).toBe(false);
		expect(old.startsWith('100-')).toBe(true);
		expect(recent.startsWith('101-')).toBe(true);
		expect([...storage.files.keys()].some((k) => k.startsWith('mcp-stash/101/'))).toBe(true);
	});

	it('sweeps on its own, without a put', async () => {
		const storage = memoryStorage();
		let now = 100 * HOUR + 1;
		const stash = createStash(storage, () => now);
		await stash.put(entry);
		now = 103 * HOUR + 1;
		await stash.sweep();
		expect([...storage.files.keys()].some((k) => k.startsWith('mcp-stash/100/'))).toBe(false);
	});

	it('resumes after a restart from the hour the last run swept, however long ago', async () => {
		const storage = memoryStorage();
		let now = 100 * HOUR + 1;
		await createStash(storage, () => now).sweep();
		await createStash(storage, () => now).put(entry);
		now = 400 * HOUR + 1;
		await createStash(storage, () => now).sweep();
		expect([...storage.files.keys()].some((k) => k.startsWith('mcp-stash/100/'))).toBe(false);
	});
});
