/**
 * Adapter conformance suite for IStorageProvider: get, put (with image
 * transcoding), delete, deletePrefix and getPublicUrl.
 */

import { describe, it, expect } from 'vitest';
import type { IStorageProvider } from '../../storage/interface.js';
import { makeExpectDenied } from './helpers.js';

export interface StorageProviderConformanceOptions {
	/** Name to show in test output (e.g. "local-filesystem"). */
	name: string;
	/** Factory that returns a fresh, empty storage per test. */
	createStorage: () => Promise<IStorageProvider> | IStorageProvider;
	/** `deletePrefix('')` and `deletePrefix('/')` throw `ProviderError(400)`, not just any error. */
	strictDenials?: boolean;
	/** `deletePrefix('a/b')` removes the directory `a/b` and leaves `a/bc`. */
	segmentPrefix?: boolean;
	/** Every method refuses a path that climbs out of the store with `..`: `ProviderError(400)` under `strictDenials`. */
	pathContainment?: boolean;
}

function bytes(text: string): Uint8Array {
	return new TextEncoder().encode(text);
}

function randomName(): string {
	return `escape-${crypto.randomUUID()}`;
}

/** FNV-1a fingerprint: one linear pass, far cheaper than a deep `toEqual` over a megabyte. */
function checksum(data: Uint8Array): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < data.length; i++) {
		h ^= data[i];
		h = Math.imul(h, 0x01000193);
	}
	return h >>> 0;
}

export function runStorageProviderConformance(opts: StorageProviderConformanceOptions): void {
	const {
		name,
		createStorage,
		strictDenials = false,
		segmentPrefix = false,
		pathContainment = false
	} = opts;
	const expectDenied = makeExpectDenied(strictDenials);

	describe(`IStorageProvider conformance: ${name}`, () => {
		it('put returns the path it stored at, and get returns the bytes', async () => {
			const storage = await createStorage();
			const plain = bytes('Hello, World!');
			const octets = bytes('{"type":"octet"}');
			expect(await storage.put('test/plain.txt', plain, 'text/plain')).toBe('test/plain.txt');
			expect(await storage.put('test/untyped.txt', plain)).toBe('test/untyped.txt');
			await storage.put('files/test.bin', octets, 'application/octet-stream');

			expect(await storage.get('test/plain.txt')).toEqual(plain);
			expect(await storage.get('test/untyped.txt')).toEqual(plain);
			expect(await storage.get('files/test.bin')).toEqual(octets);
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

		it('deletePrefix refuses a prefix that names the whole store', async () => {
			const storage = await createStorage();
			await storage.put('test/file.txt', bytes('keep'));

			await expectDenied(storage.deletePrefix(''), 400);
			await expectDenied(storage.deletePrefix('/'), 400);

			expect(await storage.get('test/file.txt')).toEqual(bytes('keep'));
		});

		if (pathContainment) {
			it('refuses a path that climbs out of the store, on every method', async () => {
				const storage = await createStorage();
				const outside = `../${randomName()}.txt`;
				const climbing = `nested/../../${randomName()}.txt`;

				await expectDenied(storage.put(outside, bytes('escaped')), 400);
				await expectDenied(storage.put(climbing, bytes('escaped')), 400);
				await expectDenied(storage.get(outside), 400);
				await expectDenied(storage.delete(outside), 400);
				await expectDenied(storage.deletePrefix('../'), 400);
			});
		}

		if (segmentPrefix) {
			it('deletePrefix stops at a path segment: a/b does not reach a/bc', async () => {
				const storage = await createStorage();
				await storage.put('a/b/x.txt', bytes('gone'));
				await storage.put('a/bc/y.txt', bytes('kept'));

				await storage.deletePrefix('a/b');

				expect(await storage.get('a/b/x.txt')).toBeNull();
				expect(await storage.get('a/bc/y.txt')).toEqual(bytes('kept'));
			});
		}

		it('deletePrefix with no matches is a no-op', async () => {
			const storage = await createStorage();
			await storage.put('other/file.txt', bytes('data'));
			await storage.deletePrefix('nonexistent/');
			// Should not throw
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

		// Raised timeout: a runner busy with every package's suites can blow the default here.
		it('handles large data', async () => {
			const storage = await createStorage();
			const large = new Uint8Array(1024 * 1024); // 1 MB
			for (let i = 0; i < large.length; i++) {
				large[i] = i % 256;
			}
			await storage.put('large/file.bin', large);
			const got = await storage.get('large/file.bin');
			expect(got).not.toBeNull();
			expect(got!.length).toBe(large.length);
			expect(checksum(got!)).toBe(checksum(large));
		}, 30_000);

		// ============================================================================
		// Image transcoding
		// ============================================================================
		//
		// Part of the `IStorageProvider.put` contract: images land as WebP at a
		// rewritten path, whatever the user uploaded.

		it('transcodes png input to webp (path rewritten, magic bytes flipped)', async () => {
			const storage = await createStorage();
			// Minimal 1×1 transparent PNG (68 bytes): 8-byte signature + IHDR + IDAT + IEND.
			// The IDAT is a real zlib stream of one scanline (filter 0 + RGBA 0,0,0,0) with a
			// correct Adler-32. Don't hand-tweak these bytes: regenerate with zlib.deflateSync.
			const pngBytes = Uint8Array.from([
				0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
				0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f,
				0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0b, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x60,
				0x00, 0x02, 0x00, 0x00, 0x05, 0x00, 0x01, 0x7a, 0x5e, 0xab, 0x3f, 0x00, 0x00, 0x00, 0x00,
				0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82
			]);
			expect(await storage.put('covers/tiny.png', pngBytes, 'image/png')).toBe('covers/tiny.webp');

			// Image transcoding rewrites the path to .webp — the original path is empty.
			const atPng = await storage.get('covers/tiny.png');
			expect(atPng).toBeNull();

			// At the webp path we get a valid RIFF/WEBP container.
			const atWebp = await storage.get('covers/tiny.webp');
			expect(atWebp).toBeTruthy();
			expect(atWebp?.slice(0, 4)).toEqual(bytes('RIFF'));
			expect(atWebp?.slice(8, 12)).toEqual(bytes('WEBP'));
		});

		it('rasterizes svg input to webp — no vector blob is ever stored', async () => {
			const storage = await createStorage();
			// A minimal SVG carrying a <script> — the exact XSS payload the
			// rasterize-everything policy is meant to neutralize.
			const svg =
				'<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">' +
				'<script>alert(1)</script><rect width="10" height="10" fill="red"/></svg>';
			const svgBytes = new TextEncoder().encode(svg);
			await storage.put('orgs/x/logo.webp', svgBytes, 'image/svg+xml');

			// The stored blob is a WebP raster, NOT the original SVG bytes — so the
			// served file can't execute script. (The path is already .webp because
			// orgPaths.asset fixes it; the content is what matters here.)
			const stored = await storage.get('orgs/x/logo.webp');
			expect(stored).toBeTruthy();
			expect(stored?.slice(0, 4)).toEqual(bytes('RIFF'));
			expect(stored?.slice(8, 12)).toEqual(bytes('WEBP'));
			// Defense-in-depth assertion: the script tag is gone from the bytes.
			expect(new TextDecoder().decode(stored!)).not.toContain('script');
		});
	});
}
