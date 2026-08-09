import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@supabase/supabase-js';
import { transcodeImageIfNeeded, classifyAssetPath } from '@selvajs/platform/storage';
import type { IStorageProvider } from '@selvajs/platform/storage';

/**
 * Storage backend for Selva on Supabase Storage. Routes each path to one of
 * two buckets: `publicBucket` (CDN-readable, `getPublicUrl` returns the
 * direct CDN URL) or `privateBucket` (`getPublicUrl` returns
 * `${privateUrlPrefix}/{path}` — the consuming app must route that prefix
 * through an auth check and `get()`).
 */
export interface SupabaseStorageProviderConfig {
	/** Supabase project URL (e.g. http://127.0.0.1:54321 for local stack). */
	supabaseUrl: string;
	/**
	 * Service-role key. The provider runs server-side and must bypass RLS
	 * for server-internal actions (admin uploads, janitor cleanup) — never
	 * used from the browser.
	 */
	serviceRoleKey: string;
	/** Bucket for CDN-readable objects. Default: "selva-public". */
	publicBucket?: string;
	/** Bucket for authenticated-only objects. Default: "selva-private". */
	privateBucket?: string;
	/** URL prefix for authenticated file downloads, used by `getPublicUrl`. Default: "/api/files". */
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
		this.publicBaseUrl = `${config.supabaseUrl.replace(/\/$/, '')}/storage/v1/object/public/${this.publicBucket}`;
		this.privateUrlPrefix = (config.privateUrlPrefix ?? '/api/files').replace(/\/$/, '');
	}

	/**
	 * `.gh`/`.ghx` source files are always private, regardless of what
	 * `classifyAssetPath` says — confidentiality by extension means a
	 * path-scheme rename can't silently move sources into the public bucket.
	 * Everything else routes by asset class.
	 */
	private bucketFor(storagePath: string): string {
		if (/\.(gh|ghx)$/i.test(storagePath)) return this.privateBucket;
		const cls = classifyAssetPath(storagePath);
		if (cls && cls.class.visibility !== 'public') return this.privateBucket;
		return this.publicBucket;
	}

	async get(storagePath: string): Promise<Uint8Array | null> {
		const bucket = this.bucketFor(storagePath);
		const { data, error } = await this.client.storage.from(bucket).download(storagePath);
		if (error) {
			// storage-js has no stable status code for 404 — match the message instead.
			const msg = (error as { message?: string }).message ?? '';
			if (/not found/i.test(msg) || /no such key/i.test(msg)) return null;
			throw error;
		}
		const buffer = await data.arrayBuffer();
		return new Uint8Array(buffer);
	}

	async put(storagePath: string, data: Uint8Array, contentType?: string): Promise<void> {
		const transcoded = await transcodeImageIfNeeded(data, contentType, storagePath);
		const bucket = this.bucketFor(transcoded.path);
		const { error } = await this.client.storage
			.from(bucket)
			.upload(transcoded.path, transcoded.data, {
				contentType: transcoded.contentType,
				// Objects are content-addressed and immutable — cache for a year.
				cacheControl: '31536000',
				upsert: true
			});
		if (error) throw error;
	}

	async delete(storagePath: string): Promise<void> {
		const bucket = this.bucketFor(storagePath);
		const { error } = await this.client.storage.from(bucket).remove([storagePath]);
		if (error) throw error;
	}

	async deletePrefix(prefix: string): Promise<void> {
		// A definition's GUID prefix may have files in either bucket.
		await Promise.all([
			this.deletePrefixInBucket(this.publicBucket, prefix),
			this.deletePrefixInBucket(this.privateBucket, prefix)
		]);
	}

	private async deletePrefixInBucket(bucket: string, prefix: string): Promise<void> {
		const normalized = prefix.replace(/\/+$/, '');
		const keys = await this.listAllKeys(bucket, normalized);
		if (keys.length === 0) return;
		// remove() caps out at 1000 paths per call.
		for (let i = 0; i < keys.length; i += 1000) {
			const slice = keys.slice(i, i + 1000);
			const { error } = await this.client.storage.from(bucket).remove(slice);
			if (error) throw error;
		}
	}

	/** storage-js's `list` only returns immediate children of a "folder", so DFS to get everything under `prefix`. */
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
				// storage-js marks folder entries with id === null.
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
		return `${this.privateUrlPrefix}/${storagePath}`;
	}
}
