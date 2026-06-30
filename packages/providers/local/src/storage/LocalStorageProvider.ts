import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { transcodeImageIfNeeded } from '@selvajs/platform/storage';
import type { IStorageProvider } from '@selvajs/platform/storage';

/**
 * Filesystem implementation of IStorageProvider.
 * Files are stored under DATA_PATH/{path}.
 * Images are auto-transcoded to WebP on put() via the shared platform helper
 * (`transcodeImageIfNeeded`) — the same helper the Supabase adapter uses,
 * so both providers produce identical bytes for the same upload.
 */
export class LocalStorageProvider implements IStorageProvider {
	private readonly basePath: string;
	private readonly publicUrlBase: string;

	static fromEnv(env: Record<string, string | undefined>): LocalStorageProvider {
		if (!env.DATA_PATH) throw new Error('Missing required env var: DATA_PATH');
		return new LocalStorageProvider(env.DATA_PATH, '/api/files');
	}

	constructor(basePath: string, publicUrlBase = '/api/files') {
		this.basePath = basePath;
		this.publicUrlBase = publicUrlBase;
	}

	/**
	 * Resolve a caller-provided path under basePath, rejecting anything that
	 * would escape the root. Last line of defense against traversal — while
	 * platform-side helpers (definitionPaths) also assert safe keys, this
	 * adapter is reached by any IStorageProvider caller.
	 */
	private resolvePath(storagePath: string): string {
		const base = path.resolve(this.basePath);
		const full = path.resolve(base, storagePath);
		if (full !== base && !full.startsWith(base + path.sep)) {
			throw new Error(`Path escapes base: ${storagePath}`);
		}
		return full;
	}

	async get(storagePath: string): Promise<Uint8Array | null> {
		try {
			const buffer = await fs.readFile(this.resolvePath(storagePath));
			return new Uint8Array(buffer);
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
			throw err;
		}
	}

	async put(storagePath: string, data: Uint8Array, contentType?: string): Promise<void> {
		// Normalize images through the shared transcoder — rewrites `.png` → `.webp`,
		// caps dimensions, and re-encodes at the platform's canonical quality.
		// Non-images pass through untouched.
		const transcoded = await transcodeImageIfNeeded(data, contentType, storagePath);
		const fullPath = this.resolvePath(transcoded.path);
		await fs.mkdir(path.dirname(fullPath), { recursive: true });
		await fs.writeFile(fullPath, Buffer.from(transcoded.data));
	}

	async delete(storagePath: string): Promise<void> {
		try {
			await fs.unlink(this.resolvePath(storagePath));
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
		}
	}

	async deletePrefix(prefix: string): Promise<void> {
		const fullPath = this.resolvePath(prefix);
		await fs.rm(fullPath, { recursive: true, force: true });
	}

	getPublicUrl(storagePath: string): string {
		// Local has no CDN, so every asset — public branding and members-only
		// blobs alike — is served through the `/api/files` proxy. The proxy
		// route classifies the path (`classifyAssetPath`) and applies the right
		// auth per visibility, so the URL shape is uniform here by design.
		return `${this.publicUrlBase}/${storagePath}`;
	}
}
