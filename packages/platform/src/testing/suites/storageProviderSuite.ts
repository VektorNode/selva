/**
 * Adapter conformance suite for IStorageProvider.
 *
 * Tests blob storage operations (get, put, delete, deletePrefix, getPublicUrl)
 * to ensure all adapters behave identically.
 */

import { describe, it, expect } from 'vitest';
import type { IStorageProvider } from '../../storage/interface.js';

export interface StorageProviderConformanceOptions {
	/** Name to show in test output (e.g. "local-filesystem"). */
	name: string;
	/** Factory that returns a fresh, empty storage per test. */
	createStorage: () => Promise<IStorageProvider> | IStorageProvider;
}

function bytes(text: string): Uint8Array {
	return new TextEncoder().encode(text);
}

export function runStorageProviderConformance(opts: StorageProviderConformanceOptions): void {
	const { name, createStorage } = opts;

	describe(`IStorageProvider conformance: ${name}`, () => {
		it('put + get returns the stored data', async () => {
			const storage = await createStorage();
			const data = bytes('Hello, World!');
			await storage.put('test/file.txt', data);
			const got = await storage.get('test/file.txt');
			expect(got).toEqual(data);
		});

		it('get returns null for missing path', async () => {
			const storage = await createStorage();
			const got = await storage.get('nonexistent/path.txt');
			expect(got).toBeNull();
		});

		it('put overwrites existing file', async () => {
			const storage = await createStorage();
			const data1 = bytes('First');
			const data2 = bytes('Second');
			await storage.put('test/file.txt', data1);
			await storage.put('test/file.txt', data2);
			const got = await storage.get('test/file.txt');
			expect(got).toEqual(data2);
		});

		it('put creates nested directories', async () => {
			const storage = await createStorage();
			const data = bytes('nested');
			await storage.put('a/b/c/d/file.txt', data);
			const got = await storage.get('a/b/c/d/file.txt');
			expect(got).toEqual(data);
		});

		it('delete removes a file', async () => {
			const storage = await createStorage();
			await storage.put('test/file.txt', bytes('data'));
			await storage.delete('test/file.txt');
			const got = await storage.get('test/file.txt');
			expect(got).toBeNull();
		});

		it('delete is a no-op for missing file', async () => {
			const storage = await createStorage();
			await storage.delete('nonexistent/file.txt');
			// Should not throw
		});

		it('deletePrefix removes all files matching prefix', async () => {
			const storage = await createStorage();
			await storage.put('definitions/guid-1/file.gh', bytes('def1'));
			await storage.put('definitions/guid-1/meta.json', bytes('{}'));
			await storage.put('definitions/guid-2/file.gh', bytes('def2'));

			await storage.deletePrefix('definitions/guid-1/');

			const file1 = await storage.get('definitions/guid-1/file.gh');
			const meta1 = await storage.get('definitions/guid-1/meta.json');
			const file2 = await storage.get('definitions/guid-2/file.gh');

			expect(file1).toBeNull();
			expect(meta1).toBeNull();
			expect(file2).toBeTruthy();
		});

		it('deletePrefix with no matches is a no-op', async () => {
			const storage = await createStorage();
			await storage.put('other/file.txt', bytes('data'));
			await storage.deletePrefix('nonexistent/');
			// Should not throw
		});

		it('getPublicUrl returns a non-empty string', async () => {
			const storage = await createStorage();
			const url = storage.getPublicUrl('test/file.txt');
			expect(url).toBeTruthy();
		});

		it('getPublicUrl is consistent for same path', async () => {
			const storage = await createStorage();
			const url1 = storage.getPublicUrl('test/file.txt');
			const url2 = storage.getPublicUrl('test/file.txt');
			expect(url1).toBe(url2);
		});

		it('getPublicUrl differs for different paths', async () => {
			const storage = await createStorage();
			const url1 = storage.getPublicUrl('test/file1.txt');
			const url2 = storage.getPublicUrl('test/file2.txt');
			expect(url1).not.toBe(url2);
		});

		it('handles binary data correctly', async () => {
			const storage = await createStorage();
			const binary = new Uint8Array([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd]);
			await storage.put('binary/data.bin', binary);
			const got = await storage.get('binary/data.bin');
			expect(got).toEqual(binary);
		});

		it('handles large data', async () => {
			const storage = await createStorage();
			const large = new Uint8Array(1024 * 1024); // 1 MB
			for (let i = 0; i < large.length; i++) {
				large[i] = i % 256;
			}
			await storage.put('large/file.bin', large);
			const got = await storage.get('large/file.bin');
			expect(got).toEqual(large);
		});

		it('put with contentType is stored', async () => {
			const storage = await createStorage();
			const data = bytes('{"type":"octet"}');
			await storage.put('files/test.bin', data, 'application/octet-stream');
			const got = await storage.get('files/test.bin');
			expect(got).toEqual(data);
		});
	});
}
