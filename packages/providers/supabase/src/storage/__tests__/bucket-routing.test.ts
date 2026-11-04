import { describe, expect, it, vi } from 'vitest';
import { SupabaseStorageProvider } from '../SupabaseStorageProvider.js';

const provider = () =>
	new SupabaseStorageProvider({ supabaseUrl: 'http://s', serviceRoleKey: 'k' });

describe('bucketFor is default-deny', () => {
	it('serves branding from the public bucket', () => {
		expect(provider().getPublicUrl('orgs/acme/branding/logo.webp')).toContain(
			'/object/public/selva-public/'
		);
	});

	it.each([
		'orgs/acme/private/2026/quote.pdf',
		'definitions/g/versions/v1.gh.bak',
		'definitions/g/assets/part.3dm'
	])('keeps unclassified %s private', (path) => {
		expect(provider().getPublicUrl(path)).toBe(`/api/files/${path}`);
	});
});

describe('deletePrefix', () => {
	it.each(['', '/', '//'])('refuses %j, which would mean the whole bucket', async (prefix) => {
		await expect(provider().deletePrefix(prefix)).rejects.toThrow(/prefix/);
	});

	it('pages past the first 1000 entries of a folder', async () => {
		const store = provider();
		const names = Array.from({ length: 2500 }, (_, i) => ({ id: `${i}`, name: `v${i}.gh` }));
		const list = vi.fn(async (_dir: string, opts: { limit: number; offset?: number }) => ({
			data: names.slice(opts.offset ?? 0, (opts.offset ?? 0) + opts.limit),
			error: null
		}));
		const removed: string[] = [];
		const remove = vi.fn(async (paths: string[]) => {
			removed.push(...paths);
			return { error: null };
		});
		Object.assign(store, { client: { storage: { from: () => ({ list, remove }) } } });

		await store.deletePrefix('definitions/g/');

		// Both buckets answer the same in this fake.
		expect(new Set(removed).size).toBe(2500);
	});
});
