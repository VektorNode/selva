import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { LocalStorageProvider } from '../LocalStorageProvider.js';

let dir: string;
let storage: LocalStorageProvider;

beforeEach(async () => {
	dir = await fs.mkdtemp(path.join(os.tmpdir(), 'selva-storage-'));
	storage = new LocalStorageProvider(dir);
});

afterEach(async () => {
	await fs.rm(dir, { recursive: true, force: true });
});

describe('LocalStorageProvider', () => {
	it('never serves a partial file while overwriting it', async () => {
		const big = new Uint8Array(4 * 1024 * 1024).fill(1);
		await storage.put('a/blob.bin', big);

		const reads: Promise<Uint8Array | null>[] = [];
		const writes: Promise<string>[] = [];
		for (let i = 0; i < 20; i++) {
			writes.push(storage.put('a/blob.bin', big));
			reads.push(storage.get('a/blob.bin'));
		}
		await Promise.all(writes);

		for (const read of await Promise.all(reads)) expect(read?.length).toBe(big.length);
	});

	it('leaves no temp files behind', async () => {
		await storage.put('a/blob.bin', new Uint8Array([1]));
		expect(await fs.readdir(path.join(dir, 'a'))).toEqual(['blob.bin']);
	});

	it.each(['get', 'delete'] as const)('refuses to %s a data file in the root', async (method) => {
		await fs.writeFile(path.join(dir, 'auth-users.json'), '{"users":[]}');
		await expect(storage[method]('auth-users.json')).rejects.toThrow(/data file/);
		await expect(storage[method]('./auth-users.json')).rejects.toThrow(/data file/);
	});

	it('refuses to overwrite a data file in the root', async () => {
		await expect(storage.put('compute.config.json', new Uint8Array([1]))).rejects.toThrow(
			/data file/
		);
	});

	it('still stores JSON below the root', async () => {
		await storage.put('definitions/g/meta.json', new Uint8Array([1]));
		expect(await storage.get('definitions/g/meta.json')).not.toBeNull();
	});
});
