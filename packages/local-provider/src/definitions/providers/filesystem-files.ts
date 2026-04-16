import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import sharp from 'sharp';
import type {
	IDefinitionFileProvider,
	DefinitionFileExt,
	HistoryEntry
} from '@selva/platform/definitions';
import { GH_EXTENSIONS, IMAGE_EXTENSIONS as ALLOWED_IMAGE_EXTENSIONS } from '@selva/platform/definitions';

export class LocalDefinitionFileProvider implements IDefinitionFileProvider {
	private readonly definitionsPath: string;
	private readonly imageUrlPrefix: string;

	constructor(definitionsPath: string, imageUrlPrefix = '/api/definitions') {
		this.definitionsPath = definitionsPath;
		this.imageUrlPrefix = imageUrlPrefix;
	}

	private guidPath(guid: string): string {
		return path.join(this.definitionsPath, guid);
	}

	private oldFilesDir(guid: string): string {
		return path.join(this.guidPath(guid), 'old_files');
	}

	// ── IDefinitionFileProvider ─────────────────────────────────────────────

	async getFile(guid: string): Promise<Uint8Array | null> {
		const guidDir = this.guidPath(guid);
		for (const ext of GH_EXTENSIONS) {
			const filePath = path.join(guidDir, `definition${ext}`);
			try {
				const buffer = await fs.readFile(filePath);
				return new Uint8Array(buffer);
			} catch {
				// try next extension
			}
		}
		return null;
	}

	async getPreviewImage(guid: string): Promise<Uint8Array | null> {
		// Read the coverImage field from the config to find the stored filename
		const configPath = path.join(this.definitionsPath, 'definitions-config.json');
		let coverImage: string | undefined;
		try {
			const content = await fs.readFile(configPath, 'utf-8');
			const config = JSON.parse(content) as { definitions: Record<string, { coverImage?: string }> };
			coverImage = config.definitions[guid]?.coverImage;
		} catch {
			return null;
		}

		if (!coverImage) return null;

		// Extract filename from the coverImage URL or path
		const imageFilename = coverImage.split('/').pop();
		if (!imageFilename) return null;

		const guidDir = this.guidPath(guid);

		// Try the stored filename, then fall back to the .webp variant
		const webpFilename = imageFilename.replace(/\.[^.]+$/, '.webp');
		const candidates =
			imageFilename === webpFilename ? [imageFilename] : [imageFilename, webpFilename];

		for (const candidate of candidates) {
			try {
				const buffer = await fs.readFile(path.join(guidDir, candidate));
				return new Uint8Array(buffer);
			} catch {
				// try next candidate
			}
		}

		return null;
	}

	async getArchivedFile(guid: string, ref: string): Promise<Uint8Array | null> {
		const filePath = path.join(this.oldFilesDir(guid), ref);
		try {
			const buffer = await fs.readFile(filePath);
			return new Uint8Array(buffer);
		} catch {
			return null;
		}
	}

	async saveFile(guid: string, data: Uint8Array, ext: DefinitionFileExt): Promise<void> {
		const guidDir = this.guidPath(guid);
		await fs.mkdir(guidDir, { recursive: true });

		// Delete any existing GH file with a different extension
		for (const existingExt of GH_EXTENSIONS) {
			if (existingExt !== `.${ext}`) {
				try {
					await fs.unlink(path.join(guidDir, `definition${existingExt}`));
				} catch {
					// Non-fatal — file may not exist
				}
			}
		}

		await fs.writeFile(path.join(guidDir, `definition.${ext}`), Buffer.from(data));
	}

	async archiveCurrentFile(guid: string, originalName: string): Promise<HistoryEntry | null> {
		const guidDir = this.guidPath(guid);

		let currentFile: string | null = null;
		try {
			const entries = await fs.readdir(guidDir);
			for (const entry of entries) {
				const entryExt = path.extname(entry).toLowerCase();
				if (entry !== 'old_files' && GH_EXTENSIONS.includes(entryExt)) {
					currentFile = entry;
					break;
				}
			}
		} catch {
			return null;
		}

		if (!currentFile) return null;

		const oldDir = this.oldFilesDir(guid);
		await fs.mkdir(oldDir, { recursive: true });

		const now = new Date();
		const timestamp = now.toISOString().replace(/[:.]/g, '-');
		const backupName = `${timestamp}_${currentFile}`;

		const data = await fs.readFile(path.join(guidDir, currentFile));
		await fs.writeFile(path.join(oldDir, backupName), data);
		await fs.unlink(path.join(guidDir, currentFile));

		return {
			ref: backupName,
			originalName,
			archivedAt: now.toISOString()
		};
	}

	async deleteArchivedFile(guid: string, ref: string): Promise<void> {
		try {
			await fs.unlink(path.join(this.oldFilesDir(guid), ref));
		} catch {
			// Non-fatal
		}
	}

	/**
	 * Save a preview image compressed to WebP.
	 * Returns the public URL for the stored image (used by callers to update meta.coverImage).
	 * The return type is void per IDefinitionFileProvider — callers read the URL via getImageUrl().
	 */
	async saveImage(guid: string, data: Uint8Array): Promise<void> {
		const guidDir = this.guidPath(guid);
		await fs.mkdir(guidDir, { recursive: true });

		// Always store as WebP
		const filename = 'cover.webp';
		const filePath = path.join(guidDir, filename);

		const compressed = await sharp(Buffer.from(data))
			.resize({ width: 1200, withoutEnlargement: true })
			.webp({ quality: 85 })
			.toBuffer();

		await fs.writeFile(filePath, compressed);

		// Delete any old image files (different name or extension)
		try {
			const entries = await fs.readdir(guidDir);
			for (const entry of entries) {
				if (
					entry !== filename &&
					ALLOWED_IMAGE_EXTENSIONS.includes(path.extname(entry).toLowerCase())
				) {
					await fs.rm(path.join(guidDir, entry), { force: true });
				}
			}
		} catch {
			// Non-fatal
		}
	}

	/** Returns the public URL for the stored cover image (always cover.webp). */
	getCoverImageUrl(guid: string): string {
		return `${this.imageUrlPrefix}/${guid}/image/cover.webp`;
	}

	async deleteFiles(guid: string): Promise<void> {
		await fs.rm(this.guidPath(guid), { recursive: true, force: true });
	}
}
