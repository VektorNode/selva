/**
 * Shared image-transcoding helper for `IStorageProvider` implementations.
 * Normalizes uploads to WebP (at most 1200px on either side, quality 85) so
 * storage, bandwidth, and the viewer path stay predictable.
 *
 * `sharp` is a dynamic import, not a hard dependency of this package —
 * providers that need transcoding install it themselves.
 */

import { ProviderError } from '../errors.js';

export const IMAGE_MAX_WIDTH = 1200;
export const IMAGE_WEBP_QUALITY = 85;

// A small upload can decode to gigabytes or burn seconds of CPU: the size cap on
// the request says nothing about either. 60 MP covers a phone camera's full frame.
const MAX_INPUT_PIXELS = 60_000_000;
const TRANSCODE_TIMEOUT_SECONDS = 10;
export const MAX_CONCURRENT_TRANSCODES = 2;

// What `metadata()` found in the bytes, whatever the client declared.
const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp', 'gif', 'tiff', 'svg']);

export interface TranscodeResult {
	data: Uint8Array;
	contentType: string;
	/** Possibly-rewritten path (non-webp inputs become `.webp`). */
	path: string;
}

/** True if the input is an image to process. The content type decides, unless it says nothing. */
export function isImageUpload(contentType: string | undefined, storagePath: string): boolean {
	if (contentType && contentType !== 'application/octet-stream') {
		return contentType.startsWith('image/');
	}
	return /\.(webp|png|jpe?g|gif|bmp|tif?f|svg)$/i.test(storagePath);
}

/**
 * Rewrites a path's extension to `.webp`; unchanged for non-image extensions.
 * SVG is rasterized like any other input, so no vector blob is ever
 * persisted — served bytes stay XSS-free without a sanitizer.
 */
export function toWebpPath(storagePath: string): string {
	return storagePath.replace(/\.(png|jpe?g|gif|bmp|tif?f|svg)$/i, '.webp');
}

/**
 * Transcodes images to WebP; passes non-images through unchanged, so
 * providers can call this unconditionally before `put`.
 *
 * Throws `ProviderError(422)` for bytes it won't process, and a plain error if
 * `sharp` isn't installed, which is a config problem rather than a bad upload.
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
	const compressed = await withTranscodeSlot(() =>
		rasterize(sharp, Buffer.from(data), contentType, storagePath)
	);

	return {
		data: new Uint8Array(compressed),
		contentType: 'image/webp',
		path: toWebpPath(storagePath)
	};
}

async function rasterize(
	sharp: SharpFn,
	input: Buffer,
	contentType: string | undefined,
	storagePath: string
): Promise<Buffer> {
	try {
		// Unlimited here: this only reads the header, and sharp's own limit would hide
		// the reason from the check below.
		const header = sharp(input, { limitInputPixels: false });
		const { format, width = 0, height = 0 } = await header.metadata();
		// SVG is the expensive format, so it has to be asked for: a route that only
		// checks the declared type must not let one in as a PNG.
		const declaredSvg = contentType === 'image/svg+xml' || /\.svg$/i.test(storagePath);
		if (!ALLOWED_FORMATS.has(format) || (format === 'svg' && !declaredSvg)) {
			throw new ProviderError(`Unsupported image format: ${format}`, 422);
		}
		if (width * height > MAX_INPUT_PIXELS) {
			throw new ProviderError('Image has too many pixels', 422);
		}
		return await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
			.autoOrient()
			.resize({
				width: IMAGE_MAX_WIDTH,
				height: IMAGE_MAX_WIDTH,
				fit: 'inside',
				withoutEnlargement: true
			})
			.webp({ quality: IMAGE_WEBP_QUALITY })
			.timeout({ seconds: TRANSCODE_TIMEOUT_SECONDS })
			.toBuffer();
	} catch (err) {
		if (err instanceof ProviderError) throw err;
		throw new ProviderError('The image could not be read', 422);
	}
}

let activeTranscodes = 0;
const waitingTranscodes: (() => void)[] = [];

/** Runs `fn` when a slot is free. A finishing transcode hands its slot straight to the next. */
export async function withTranscodeSlot<T>(fn: () => Promise<T>): Promise<T> {
	if (activeTranscodes < MAX_CONCURRENT_TRANSCODES) {
		activeTranscodes += 1;
	} else {
		await new Promise<void>((resolve) => waitingTranscodes.push(resolve));
	}
	try {
		return await fn();
	} finally {
		const next = waitingTranscodes.shift();
		if (next) next();
		else activeTranscodes -= 1;
	}
}

// sharp >=0.35 is ESM-only: the callable lives on `default`, so the namespace
// type itself is no longer callable. Take the type off `default` and keep the
// `?? mod` runtime fallback for the older CJS shape.
type SharpFn = typeof import('sharp').default;
// Not a literal: a browser build of the root barrel would try to resolve it.
const SHARP_MODULE = 'sharp';
let cachedSharp: SharpFn | null = null;

async function loadSharp(): Promise<SharpFn> {
	if (cachedSharp) return cachedSharp;
	try {
		const mod = (await import(/* @vite-ignore */ SHARP_MODULE)) as unknown as { default: SharpFn };
		cachedSharp = mod.default ?? (mod as unknown as SharpFn);
		return cachedSharp;
	} catch (err) {
		throw new Error(
			'Image transcoding requires `sharp` to be installed. Add it as a dependency in your provider package.',
			{ cause: err }
		);
	}
}
