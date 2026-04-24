import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@supabase/supabase-js';
import { transcodeImageIfNeeded } from '@selva/platform/storage';
import type { IStorageProvider } from '@selva/platform/storage';

/**
 * Storage backend for Selva on Supabase Storage.
 *
 * Uses two buckets:
 *   - {publicBucket} (public): cover images, archive thumbnails, anything
 *     CDN-safe. `getPublicUrl` returns the direct CDN URL.
 *   - {privateBucket} (private): .gh / .ghx source files. `getPublicUrl`
 *     returns the authenticated proxy URL (`${privateUrlPrefix}/{path}`) —
 *     the consuming app must have a route at that prefix that authenticates
 *     the request and streams the bytes via `get()`.
 *
 * Path routing: any path whose basename matches `definition.{ext}` is
 * considered private. Covers (`cover.webp`) and archives (`archive/{ref}`)
 * stay public. `definitionPaths` from @selva/platform produces exactly these
 * names, so the routing is implicit — no caller has to think about buckets.
 */
export interface SupabaseStorageProviderConfig {
	/** Supabase project URL (e.g. http://127.0.0.1:54321 for local stack). */
	supabaseUrl: string;
	/**
	 * Service-role key. Required because the provider runs server-side and
	 * must bypass RLS for server-internal actions (admin uploads, janitor
	 * cleanup). The provider is never used directly from the browser.
	 */
	serviceRoleKey: string;
	/** Bucket for CDN-readable objects. Default: "selva-public". */
	publicBucket?: string;
	/** Bucket for authenticated-only objects. Default: "selva-private". */
	privateBucket?: string;
	/**
	 * URL prefix the app exposes for authenticated file downloads. Used by
	 * `getPublicUrl` for private-bucket paths. Default: "/api/files".
	 * The matching SvelteKit route is expected to call `get()` and stream
	 * bytes back after an auth check.
	 */
	privateUrlPrefix?: string;
}

export class SupabaseStorageProvider implements IStorageProvider {
	private readonly client: SupabaseClient;
	private readonly publicBucket: string;
	private readonly privateBucket: string;
	private readonly publicBaseUrl: string;
	private readonly privateUrlPrefix: string;

	static fromEnv(env: Record<string, string | undefined>): SupabaseStorageProvider {
		const supabaseUrl = env.SUPABASE_URL;
		const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
		if (!supabaseUrl) throw new Error('Missing required env var: SUPABASE_URL');
		if (!serviceRoleKey) throw new Error('Missing required env var: SUPABASE_SERVICE_ROLE_KEY');
		return new SupabaseStorageProvider({
			supabaseUrl,
			serviceRoleKey,
			publicBucket: env.SUPABASE_PUBLIC_BUCKET,
			privateBucket: env.SUPABASE_PRIVATE_BUCKET,
			privateUrlPrefix: env.SUPABASE_PRIVATE_URL_PREFIX
		});
	}

	constructor(config: SupabaseStorageProviderConfig) {
		this.client = createClient(config.supabaseUrl, config.serviceRoleKey, {
			auth: { persistSession: false, autoRefreshToken: false }
		});
		this.publicBucket = config.publicBucket ?? 'selva-public';
		this.privateBucket = config.privateBucket ?? 'selva-private';
		// Direct CDN URL format: {supabaseUrl}/storage/v1/object/public/{bucket}/{path}
		this.publicBaseUrl = `${config.supabaseUrl.replace(/\/$/, '')}/storage/v1/object/public/${this.publicBucket}`;
		this.privateUrlPrefix = (config.privateUrlPrefix ?? '/api/files').replace(/\/$/, '');
	}

	/**
	 * Route a storage path to a bucket. Paths ending in `definition.gh` or
	 * `definition.ghx` are private; everything else is public. This mirrors
	 * what `definitionPaths.file(guid, ext)` produces.
	 */
	private bucketFor(storagePath: string): string {
		return /\/definition\.(gh|ghx)$/i.test(storagePath) ? this.privateBucket : this.publicBucket;
	}

	async get(storagePath: string): Promise<Uint8Array | null> {
		const bucket = this.bucketFor(storagePath);
		const { data, error } = await this.client.storage.from(bucket).download(storagePath);
		if (error) {
			// storage-js surfaces 404 as an error with message "Object not found".
			// Normalize any "not found" to null — we don't have a stable status code.
			const msg = (error as { message?: string }).message ?? '';
			if (/not found/i.test(msg) || /no such key/i.test(msg)) return null;
			throw error;
		}
		const buffer = await data.arrayBuffer();
		return new Uint8Array(buffer);
	}

	async put(storagePath: string, data: Uint8Array, contentType?: string): Promise<void> {
		// Normalize images through the shared helper so this provider produces
		// the same bytes / extensions as LocalStorageProvider for the same input.
		const transcoded = await transcodeImageIfNeeded(data, contentType, storagePath);
		const bucket = this.bucketFor(transcoded.path);
		const { error } = await this.client.storage
			.from(bucket)
			.upload(transcoded.path, transcoded.data, {
				contentType: transcoded.contentType,
				upsert: true
			});
		if (error) throw error;
	}

	async delete(storagePath: string): Promise<void> {
		const bucket = this.bucketFor(storagePath);
		const { error } = await this.client.storage.from(bucket).remove([storagePath]);
		// remove() does not error for missing paths — it just returns an empty array.
		if (error) throw error;
	}

	async deletePrefix(prefix: string): Promise<void> {
		// Hit both buckets: a definition's GUID prefix may have files in each.
		// Scoped by the trailing slash in the prefix, so siblings aren't touched.
		await Promise.all([
			this.deletePrefixInBucket(this.publicBucket, prefix),
			this.deletePrefixInBucket(this.privateBucket, prefix)
		]);
	}

	private async deletePrefixInBucket(bucket: string, prefix: string): Promise<void> {
		const normalized = prefix.replace(/\/+$/, '');
		const keys = await this.listAllKeys(bucket, normalized);
		if (keys.length === 0) return;
		// `remove` accepts up to 1000 paths; batch just in case.
		for (let i = 0; i < keys.length; i += 1000) {
			const slice = keys.slice(i, i + 1000);
			const { error } = await this.client.storage.from(bucket).remove(slice);
			if (error) throw error;
		}
	}

	/**
	 * Recursively list every key under a prefix. `storage-js`'s `list` API
	 * only returns the immediate children of a "folder", so we DFS.
	 */
	private async listAllKeys(bucket: string, prefix: string): Promise<string[]> {
		const out: string[] = [];
		const stack: string[] = [prefix];
		while (stack.length > 0) {
			const dir = stack.pop()!;
			const { data, error } = await this.client.storage.from(bucket).list(dir, {
				limit: 1000,
				sortBy: { column: 'name', order: 'asc' }
			});
			if (error) throw error;
			for (const entry of data ?? []) {
				const full = dir ? `${dir}/${entry.name}` : entry.name;
				// Folder entries have `id === null` in storage-js.
				if (entry.id === null) {
					stack.push(full);
				} else {
					out.push(full);
				}
			}
		}
		return out;
	}

	getPublicUrl(storagePath: string): string {
		if (this.bucketFor(storagePath) === this.publicBucket) {
			return `${this.publicBaseUrl}/${storagePath}`;
		}
		// Private files: the app's authenticated proxy route. See `privateUrlPrefix`.
		return `${this.privateUrlPrefix}/${storagePath}`;
	}
}
