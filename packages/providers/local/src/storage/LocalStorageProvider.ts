import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { transcodeImageIfNeeded } from '@selvajs/platform/storage';
import type { IStorageProvider } from '@selvajs/platform/storage';

/**
 * Filesystem implementation of `IStorageProvider`. Files live under
 * `DATA_PATH/{path}`. `put()` transcodes images to WebP via the shared
 * `transcodeImageIfNeeded` helper — the same one the Supabase adapter uses,
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
	 * Resolves a caller-provided path under basePath; rejects anything that
	 * would escape the root. Last line of defense against traversal — this
	 * adapter is reached by any `IStorageProvider` caller, not just ones that
	 * already validated the key.
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
		// Rewrites images to .webp; non-images pass through untouched.
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
		// No CDN locally — every asset goes through the `/api/files` proxy, which
		// classifies the path (`classifyAssetPath`) and applies auth per visibility.
		return `${this.publicUrlBase}/${storagePath}`;
	}
}
