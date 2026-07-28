/**
 * Shared image-transcoding helper for `IStorageProvider` implementations.
 * Cover images are normalized to WebP at upload time (capped at 1200px,
 * quality 85) so storage/bandwidth stays predictable and the viewer path
 * is uniform.
 *
 * `sharp` is loaded via a dynamic import so the platform package has no
 * hard runtime dependency on it — install it in providers that need
 * transcoding (optional peer dependency).
 */

export const IMAGE_MAX_WIDTH = 1200;
export const IMAGE_WEBP_QUALITY = 85;

export interface TranscodeResult {
	data: Uint8Array;
	contentType: string;
	/** Possibly-rewritten path (non-webp inputs become `.webp`). */
	path: string;
}

/** True if the input looks like an image to process — by content type or path extension. */
export function isImageUpload(contentType: string | undefined, storagePath: string): boolean {
	if (contentType?.startsWith('image/')) return true;
	return /\.(webp|png|jpe?g|gif|bmp|tif?f|svg)$/i.test(storagePath);
}

/**
 * Rewrite a path's extension to `.webp`. Unchanged if not a recognized image
 * extension. SVG is included: every upload (including SVG) is rasterized to
 * WebP, so a `.svg` input is stored as `.webp` — no vector blob is ever
 * persisted, which keeps the served bytes XSS-free without a sanitizer.
 */
export function toWebpPath(storagePath: string): string {
	return storagePath.replace(/\.(png|jpe?g|gif|bmp|tif?f|svg)$/i, '.webp');
}

/**
 * If the input is an image, transcode to WebP (capped + re-encoded) and
 * return rewritten bytes/content-type/path. Non-images pass through, so
 * providers can call this unconditionally before `put`.
 *
 * Throws if `sharp` isn't installed — that's a config error, not a fallback.
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

// sharp >=0.35 is ESM-only: the callable lives on `default`, so the namespace
// type itself is no longer callable. Take the type off `default` and keep the
// `?? mod` runtime fallback for the older CJS shape.
type SharpFn = typeof import('sharp').default;
let cachedSharp: SharpFn | null = null;

async function loadSharp(): Promise<SharpFn> {
	if (cachedSharp) return cachedSharp;
	try {
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
