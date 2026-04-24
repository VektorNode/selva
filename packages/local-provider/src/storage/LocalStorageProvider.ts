import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import sharp from 'sharp';
import type { IStorageProvider } from '@selva/platform/storage';

/**
 * Filesystem implementation of IStorageProvider.
 * Files are stored under DATA_PATH/{path}.
 * Images (*.webp, *.jpg, etc.) are auto-transcoded to WebP on put().
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
		const fullPath = this.resolvePath(storagePath);
		await fs.mkdir(path.dirname(fullPath), { recursive: true });

		// Auto-transcode images to WebP
		if (contentType?.startsWith('image/') && !storagePath.endsWith('.webp')) {
			const compressed = await sharp(Buffer.from(data))
				.resize({ width: 1200, withoutEnlargement: true })
				.webp({ quality: 85 })
				.toBuffer();
			await fs.writeFile(fullPath, compressed);
		} else if (contentType === 'image/webp' || storagePath.endsWith('.webp')) {
			// Already webp — still run through sharp to ensure correct dimensions/quality
			const compressed = await sharp(Buffer.from(data))
				.resize({ width: 1200, withoutEnlargement: true })
				.webp({ quality: 85 })
				.toBuffer();
			await fs.writeFile(fullPath, compressed);
		} else {
			await fs.writeFile(fullPath, Buffer.from(data));
		}
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
		return `${this.publicUrlBase}/${storagePath}`;
	}
}
