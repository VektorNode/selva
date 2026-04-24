import { describe, beforeEach, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { runStorageProviderConformance } from '@selva/platform/testing';
import { SupabaseStorageProvider } from '../SupabaseStorageProvider.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PUBLIC_BUCKET = process.env.SUPABASE_PUBLIC_BUCKET ?? 'selva-public';
const PRIVATE_BUCKET = process.env.SUPABASE_PRIVATE_BUCKET ?? 'selva-private';

// The conformance suite hits a live Supabase stack. If creds aren't present
// (e.g. in CI without Docker, or a clean clone pre-`supabase start`), skip
// the suite with a single explanatory test so the run surfaces the reason.
const liveStackAvailable = Boolean(SUPABASE_URL && SERVICE_ROLE_KEY);

if (!liveStackAvailable) {
	describe.skip('SupabaseStorageProvider (skipped: no live stack)', () => {
		it('populate packages/supabase-provider/.env.test with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (from `npx supabase start`) to run these tests', () => {});
	});
} else {
	const adminClient = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
		auth: { persistSession: false, autoRefreshToken: false }
	});

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
	});
}
