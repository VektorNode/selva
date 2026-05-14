import { describe, beforeEach, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { runStorageProviderConformance } from '@selvajs/platform/testing';
import { definitionPaths } from '@selvajs/platform';
import { SupabaseStorageProvider } from '../SupabaseStorageProvider.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PUBLIC_BUCKET = process.env.SUPABASE_PUBLIC_BUCKET ?? 'selva-public';
const PRIVATE_BUCKET = process.env.SUPABASE_PRIVATE_BUCKET ?? 'selva-private';

// The conformance suite hits a live Supabase stack. If creds aren't present
// (e.g. in CI without Docker, or a clean clone pre-`supabase start`), skip
// the suite with a single explanatory test so the run surfaces the reason.
// `createClient` transitively loads `@supabase/realtime-js`, which on Node < 22
// throws at construction without native WebSocket — treat that as "no stack"
// rather than crashing the suite during collection.
function tryBuildAdminClient(): ReturnType<typeof createClient> | null {
	if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return null;
	try {
		return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
			auth: { persistSession: false, autoRefreshToken: false }
		});
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (msg.includes('WebSocket')) return null;
		throw err;
	}
}
const _adminClient = tryBuildAdminClient();

if (_adminClient === null) {
	describe.skip('SupabaseStorageProvider (skipped: no live stack)', () => {
		it('populate packages/providers/supabase/.env.test with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (from `npx supabase start`) to run these tests', () => {});
	});
} else {
	// Re-bind in this branch so closures below see the non-null narrowed type.
	const adminClient = _adminClient;

	/**
	 * Delete every object under a prefix in a bucket. The conformance suite
	 * assumes fresh state per test; Supabase Storage is shared across runs,
	 * so we reset both buckets before each test.
	 */
	async function emptyBucket(bucket: string): Promise<void> {
		const keys: string[] = [];
		const stack: string[] = [''];
		while (stack.length > 0) {
			const dir = stack.pop()!;
			const { data, error } = await adminClient.storage.from(bucket).list(dir, {
				limit: 1000,
				sortBy: { column: 'name', order: 'asc' }
			});
			if (error) throw error;
			for (const entry of data ?? []) {
				const full = dir ? `${dir}/${entry.name}` : entry.name;
				if (entry.id === null) stack.push(full);
				else keys.push(full);
			}
		}
		if (keys.length === 0) return;
		for (let i = 0; i < keys.length; i += 1000) {
			const { error } = await adminClient.storage.from(bucket).remove(keys.slice(i, i + 1000));
			if (error) throw error;
		}
	}

	describe('SupabaseStorageProvider', () => {
		beforeEach(async () => {
			await Promise.all([emptyBucket(PUBLIC_BUCKET), emptyBucket(PRIVATE_BUCKET)]);
		});

		runStorageProviderConformance({
			name: 'SupabaseStorageProvider',
			createStorage: () =>
				new SupabaseStorageProvider({
					supabaseUrl: SUPABASE_URL!,
					serviceRoleKey: SERVICE_ROLE_KEY!,
					publicBucket: PUBLIC_BUCKET,
					privateBucket: PRIVATE_BUCKET
				})
		});

		// ============================================================================
		// Bucket routing — Supabase-specific (the conformance suite is provider-
		// agnostic and can't see which bucket a file lands in). Without these tests
		// a regex regression in `bucketFor` could silently move .gh source files
		// into the public/CDN bucket.
		// ============================================================================
		describe('bucket routing', () => {
			const storage = new SupabaseStorageProvider({
				supabaseUrl: SUPABASE_URL!,
				serviceRoleKey: SERVICE_ROLE_KEY!,
				publicBucket: PUBLIC_BUCKET,
				privateBucket: PRIVATE_BUCKET
			});

			async function existsInBucket(bucket: string, path: string): Promise<boolean> {
				const { data, error } = await adminClient.storage.from(bucket).download(path);
				if (error) return false;
				return Boolean(data);
			}

			it('versioned .gh files land in the private bucket', async () => {
				const guid = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
				const path = definitionPaths.version(guid, 1, 'gh');
				await storage.put(path, new TextEncoder().encode('GH_BYTES'));
				expect(await existsInBucket(PRIVATE_BUCKET, path)).toBe(true);
				expect(await existsInBucket(PUBLIC_BUCKET, path)).toBe(false);
			});

			it('versioned .ghx files land in the private bucket', async () => {
				const guid = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
				const path = definitionPaths.version(guid, 3, 'ghx');
				await storage.put(path, new TextEncoder().encode('GHX_BYTES'));
				expect(await existsInBucket(PRIVATE_BUCKET, path)).toBe(true);
				expect(await existsInBucket(PUBLIC_BUCKET, path)).toBe(false);
			});

			it('cover images land in the public bucket', async () => {
				const guid = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
				const path = definitionPaths.image(guid);
				// Real 1×1 transparent PNG. The provider runs every image through
				// transcodeImageIfNeeded → sharp, so a hand-crafted byte stub
				// would fail the decode. Routing (the test's actual concern) is
				// independent of which format the input arrives in.
				const tinyPng = Uint8Array.from([
					137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8,
					6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 9, 112, 72, 89, 115, 0, 0, 3, 232, 0, 0, 3, 232, 1,
					181, 123, 82, 107, 0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 96, 96, 96, 96, 0, 0, 0, 5,
					0, 1, 165, 246, 69, 64, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130
				]);
				await storage.put(path, tinyPng, 'image/png');
				expect(await existsInBucket(PUBLIC_BUCKET, path)).toBe(true);
				expect(await existsInBucket(PRIVATE_BUCKET, path)).toBe(false);
			});

			it('getPublicUrl returns the proxy prefix for private files', () => {
				const path = definitionPaths.version('guid-1', 1, 'gh');
				const url = storage.getPublicUrl(path);
				expect(url.startsWith('/api/files/')).toBe(true);
				expect(url).not.toContain('/storage/v1/object/public/');
			});

			it('getPublicUrl returns the CDN URL for public files', () => {
				const path = definitionPaths.image('guid-1');
				const url = storage.getPublicUrl(path);
				expect(url).toContain(`/storage/v1/object/public/${PUBLIC_BUCKET}/`);
			});
		});
	});
}
