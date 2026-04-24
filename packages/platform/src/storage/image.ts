/**
 * Shared image-transcoding helper for `IStorageProvider` implementations.
 *
 * Selva covers (cover.webp) and other user-uploaded images are normalized to
 * WebP at upload time: capped at 1200px wide, re-encoded at quality 85. This
 * keeps storage/bandwidth predictable and the viewer path uniform.
 *
 * Kept in the platform package so every provider gets the same behavior —
 * dropping it in one adapter would silently break the cover-image pipeline
 * in ways the conformance suite doesn't catch (the bytes roundtrip fine,
 * but the resulting image is the wrong format/size).
 *
 * `sharp` is loaded via a dynamic import so this module has no hard
 * runtime dependency on it — install sharp only in providers that need
 * transcoding. See the optional peer dependency in package.json.
 */

/** Max width in pixels. Images wider than this are resized, preserving aspect ratio. */
export const IMAGE_MAX_WIDTH = 1200;
/** WebP encoder quality. Higher = larger file, better visual fidelity. */
export const IMAGE_WEBP_QUALITY = 85;

export interface TranscodeResult {
	data: Uint8Array;
	contentType: string;
	/** Possibly-rewritten path (non-webp inputs become `.webp`). */
	path: string;
}

/**
 * Returns true if the input looks like an image that the helper should
 * process — by content type OR by the path ending in a known image
 * extension. Keeps the contract self-documenting for providers.
 */
export function isImageUpload(contentType: string | undefined, storagePath: string): boolean {
	if (contentType?.startsWith('image/')) return true;
	return /\.(webp|png|jpe?g|gif|bmp|tif?f)$/i.test(storagePath);
}

/**
 * Rewrite a storage path's extension to `.webp`. Images uploaded under e.g.
 * `cover.png` end up stored at `cover.webp` so the public URL is stable.
 * Paths without a recognizable image extension are returned unchanged.
 */
export function toWebpPath(storagePath: string): string {
	return storagePath.replace(/\.(png|jpe?g|gif|bmp|tif?f)$/i, '.webp');
}

/**
 * If the input is an image, transcode it to WebP (capped + re-encoded) and
 * return the rewritten bytes/content-type/path. Non-images pass through
 * untouched so providers can call this unconditionally before `put`.
 *
 * Throws if `sharp` isn't installed in the host runtime — that's a
 * configuration error (peer dep missing), not a runtime fallback.
 */
export async function transcodeImageIfNeeded(
	data: Uint8Array,
	contentType: string | undefined,
	storagePath: string
): Promise<TranscodeResult> {
	if (!isImageUpload(contentType, storagePath)) {
		return { data, contentType: contentType ?? 'application/octet-stream', path: storagePath };
	}

	const sharp = await loadSharp();
	const compressed = await sharp(Buffer.from(data))
		.resize({ width: IMAGE_MAX_WIDTH, withoutEnlargement: true })
		.webp({ quality: IMAGE_WEBP_QUALITY })
		.toBuffer();

	return {
		data: new Uint8Array(compressed),
		contentType: 'image/webp',
		path: toWebpPath(storagePath)
	};
}

// ── Internals ─────────────────────────────────────────────────────────────

type SharpFn = typeof import('sharp');
let cachedSharp: SharpFn | null = null;

async function loadSharp(): Promise<SharpFn> {
	if (cachedSharp) return cachedSharp;
	try {
		// sharp's type declaration exposes the callable factory as the
		// default export; under `esModuleInterop` the namespace object
		// forwards to it. Assigning directly avoids double-unwrap drift
		// between sharp versions.
		const mod = (await import('sharp')) as unknown as { default: SharpFn };
		cachedSharp = mod.default ?? (mod as unknown as SharpFn);
		return cachedSharp;
	} catch (err) {
		throw new Error(
			'Image transcoding requires `sharp` to be installed. Add it as a dependency in your provider package.',
			{ cause: err as Error }
		);
	}
}
