/**
 * Shared image-transcoding helper for `IStorageProvider` implementations.
 * Normalizes uploads to WebP (at most 1200px on either side, quality 85) so
 * storage, bandwidth, and the viewer path stay predictable.
 *
 * `sharp` is a dynamic import, not a hard dependency of this package —
 * providers that need transcoding install it themselves.
 */

import { ProviderError } from '../errors/index.js';

export const IMAGE_MAX_WIDTH = 1200;
export const IMAGE_WEBP_QUALITY = 85;

// A small upload can decode to gigabytes or burn seconds of CPU: the size cap on
// the request says nothing about either. 60 MP covers a phone camera's full frame.
const MAX_INPUT_PIXELS = 60_000_000;
// Area alone lets a 1 x 59,000,000 strip through, which decodes past the timeout.
const MAX_INPUT_SIDE = 16_384;
const TRANSCODE_TIMEOUT_SECONDS = 10;
export const MAX_CONCURRENT_TRANSCODES = 2;
export const MAX_WAITING_TRANSCODES = 8;
// Two worst-case transcodes ahead of a waiter; past that the client should retry.
const TRANSCODE_WAIT_MS = 2 * TRANSCODE_TIMEOUT_SECONDS * 1000;

// librsvg can draw for minutes without sharp's timeout firing: a filter, nested
// `<use>`, masks or markers, a fine dash pattern. A declared SVG has to be cheap
// before it reaches sharp.
const SVG_MAX_BYTES = 1024 * 1024;
const SVG_MAX_ELEMENTS = 10_000;
// Encodings that spell markup in plain ASCII bytes, so the checks can see it.
const SVG_ENCODINGS = new Set(['utf-8', 'us-ascii', 'iso-8859-1']);

type ImageFormat = 'jpeg' | 'png' | 'gif' | 'webp' | 'tiff' | 'svg';

export interface TranscodeResult {
	data: Uint8Array;
	contentType: string;
	/** Possibly-rewritten path (non-webp inputs become `.webp`). */
	path: string;
}

/** True if the input is an image to process. The content type decides, unless it says nothing. */
export function isImageUpload(contentType: string | undefined, storagePath: string): boolean {
	const type = mediaType(contentType);
	if (type && type !== 'application/octet-stream') {
		return type.startsWith('image/');
	}
	return /\.(webp|png|jpe?g|gif|tif?f|svg)$/i.test(storagePath);
}

/**
 * Rewrites a path's extension to `.webp`; unchanged for non-image extensions.
 * SVG is rasterized like any other input, so no vector blob is ever
 * persisted — served bytes stay XSS-free without a sanitizer.
 */
export function toWebpPath(storagePath: string): string {
	return storagePath.replace(/\.(png|jpe?g|gif|tif?f|svg)$/i, '.webp');
}

/**
 * Transcodes images to WebP; passes non-images through unchanged, so
 * providers can call this unconditionally before `put`.
 *
 * Throws `ProviderError(422)` for bytes it won't process, `ProviderError(503)`
 * when too many transcodes are queued, and a plain error if `sharp` isn't
 * installed, which is a config problem rather than a bad upload.
 */
export async function transcodeImageIfNeeded(
	data: Uint8Array,
	contentType: string | undefined,
	storagePath: string
): Promise<TranscodeResult> {
	if (!isImageUpload(contentType, storagePath)) {
		return { data, contentType: contentType ?? 'application/octet-stream', path: storagePath };
	}

	const input = Buffer.from(data);
	const format = checkFormat(input, contentType, storagePath);
	const sharp = await loadSharp();
	const compressed = await withTranscodeSlot(() => rasterize(sharp, input, format));

	return {
		data: new Uint8Array(compressed),
		contentType: 'image/webp',
		path: toWebpPath(storagePath)
	};
}

function mediaType(contentType: string | undefined): string {
	return (contentType ?? '').split(';')[0].trim().toLowerCase();
}

/** Refuses what sharp should never parse, from the bytes alone. */
function checkFormat(
	input: Buffer,
	contentType: string | undefined,
	storagePath: string
): ImageFormat {
	const format = sniffFormat(input);
	if (!format) throw new ProviderError('Unsupported image format', 422);
	if (format === 'svg') {
		// SVG is the expensive format, so it has to be asked for: a route that only
		// checks the declared type must not let one in as a PNG.
		const declared = mediaType(contentType) === 'image/svg+xml' || /\.svg$/i.test(storagePath);
		if (!declared) throw new ProviderError('SVG content needs the image/svg+xml type', 422);
		checkSvg(input);
	}
	return format;
}

function sniffFormat(input: Buffer): ImageFormat | null {
	const head = input.subarray(0, 12).toString('latin1');
	if (head.startsWith('\xFF\xD8\xFF')) return 'jpeg';
	if (head.startsWith('\x89PNG\r\n\x1A\n')) return 'png';
	if (head.startsWith('GIF87a') || head.startsWith('GIF89a')) return 'gif';
	if (head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP') return 'webp';
	if (head.startsWith('II*\0') || head.startsWith('MM\0*')) return 'tiff';
	if (/^(?:\xEF\xBB\xBF)?[\t\n\r ]*</.test(input.subarray(0, 1024).toString('latin1')))
		return 'svg';
	return null;
}

/**
 * Refuses an SVG that could draw slowly, or pull in one that does: a `data:` URL
 * (librsvg follows it to another SVG or stylesheet) or an entity (which can spell
 * anything). librsvg decodes character references and CSS escapes, and joins
 * `<style>` text across comments and child elements, so the checks read the text
 * the same way.
 */
function checkSvg(input: Buffer): void {
	const refuse = (why: string) => new ProviderError(`SVG ${why}`, 422);
	if (input.length > SVG_MAX_BYTES) throw refuse(`is larger than ${SVG_MAX_BYTES / 1024} KB`);
	const text = input.toString('latin1');
	// A NUL byte means UTF-16 or similar, where markup is not spelled in ASCII.
	if (input.includes(0) || !SVG_ENCODINGS.has(declaredEncoding(text))) {
		throw refuse('must be UTF-8');
	}
	if (/<!ENTITY/i.test(text)) throw refuse('may not declare entities');
	let elements = 0;
	for (const _ of text.matchAll(/<[A-Za-z_:]/g)) {
		if (++elements > SVG_MAX_ELEMENTS) throw refuse(`has more than ${SVG_MAX_ELEMENTS} elements`);
	}
	for (const seen of [unescapeSvg(text), unescapeSvg(textContent(text))]) {
		if (/filter/i.test(seen) || /<(?:[\w.-]+:)?fe[A-Z]/.test(seen)) {
			throw refuse('filters are not accepted');
		}
		if (/<(?:[\w.-]+:)?use\b/.test(seen) || /mask|marker|dasharray/i.test(seen)) {
			throw refuse('<use>, masks, markers and dash patterns are not accepted');
		}
		// A URL parser drops tabs and newlines, so `da&#9;ta:` is `data:`.
		if (/d[\t\n\r]*a[\t\n\r]*t[\t\n\r]*a[\t\n\r]*:/i.test(seen)) {
			throw refuse('may not embed data: URLs');
		}
	}
}

function declaredEncoding(text: string): string {
	const decl = /^(?:\xEF\xBB\xBF)?<\?xml[^>]*\bencoding\s*=\s*["']([^"']*)["']/.exec(text);
	return decl ? decl[1].toLowerCase() : 'utf-8';
}

function unescapeSvg(text: string): string {
	return text
		.replace(/&#(?:x([0-9a-f]+)|(\d+));/gi, (_, hex: string | undefined, dec: string | undefined) =>
			codePoint(hex ? parseInt(hex, 16) : Number(dec))
		)
		.replace(
			/\\(?:([0-9a-f]{1,6})[\t\n\r ]?|([^\n]))/gi,
			(_, hex: string | undefined, ch: string) => (hex ? codePoint(parseInt(hex, 16)) : ch)
		);
}

function codePoint(n: number): string {
	return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
}

/** Character data only: comments, tags and processing instructions dropped, CDATA kept. */
function textContent(text: string): string {
	let out = '';
	let i = 0;
	// indexOf, not a regex: an unterminated `<!--` would make a lazy regex quadratic.
	while (i < text.length) {
		if (text.startsWith('<!--', i)) {
			const end = text.indexOf('-->', i + 4);
			i = end < 0 ? text.length : end + 3;
		} else if (text.startsWith('<![CDATA[', i)) {
			const end = text.indexOf(']]>', i + 9);
			out += text.slice(i + 9, end < 0 ? text.length : end);
			i = end < 0 ? text.length : end + 3;
		} else if (text[i] === '<') {
			const end = text.indexOf('>', i + 1);
			i = end < 0 ? text.length : end + 1;
		} else {
			const end = text.indexOf('<', i);
			out += text.slice(i, end < 0 ? text.length : end);
			i = end < 0 ? text.length : end;
		}
	}
	return out;
}

async function rasterize(sharp: SharpFn, input: Buffer, format: ImageFormat): Promise<Buffer> {
	try {
		// Unlimited here: this only reads the header, and sharp's own limit would hide
		// the reason from the checks below.
		const header = sharp(input, { limitInputPixels: false });
		const meta = await header.metadata();
		if (meta.format !== format) {
			throw new ProviderError(`Unsupported image format: ${meta.format}`, 422);
		}
		const { width = 0, height = 0 } = meta;
		if (width > MAX_INPUT_SIDE || height > MAX_INPUT_SIDE) {
			throw new ProviderError(`Image is more than ${MAX_INPUT_SIDE} pixels on a side`, 422);
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
		// libvips words it "timeout: 40% complete".
		if (err instanceof Error && /^timeout:/m.test(err.message)) {
			throw new ProviderError(
				`The image took more than ${TRANSCODE_TIMEOUT_SECONDS} seconds to process`,
				422
			);
		}
		throw new ProviderError('The image could not be read', 422);
	}
}

let activeTranscodes = 0;
const waitingTranscodes: (() => void)[] = [];

/**
 * Runs `fn` when a slot is free. A finishing transcode hands its slot straight to
 * the next. Throws `ProviderError(503)` when the queue is full or the wait runs out.
 */
export async function withTranscodeSlot<T>(fn: () => Promise<T>): Promise<T> {
	if (activeTranscodes < MAX_CONCURRENT_TRANSCODES) {
		activeTranscodes += 1;
	} else {
		await waitForSlot();
	}
	try {
		return await fn();
	} finally {
		const next = waitingTranscodes.shift();
		if (next) next();
		else activeTranscodes -= 1;
	}
}

function waitForSlot(): Promise<void> {
	const busy = () =>
		new ProviderError('Too many images are being processed. Try again shortly.', 503);
	if (waitingTranscodes.length >= MAX_WAITING_TRANSCODES) return Promise.reject(busy());
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			waitingTranscodes.splice(waitingTranscodes.indexOf(start), 1);
			reject(busy());
		}, TRANSCODE_WAIT_MS);
		const start = () => {
			clearTimeout(timer);
			resolve();
		};
		waitingTranscodes.push(start);
	});
}

type SharpFn = typeof import('sharp').default;
// Not a literal: a browser build of the root barrel would try to resolve it.
const SHARP_MODULE = 'sharp';
let cachedSharp: SharpFn | null = null;

async function loadSharp(): Promise<SharpFn> {
	if (cachedSharp) return cachedSharp;
	try {
		const mod = (await import(/* @vite-ignore */ SHARP_MODULE)) as unknown as { default: SharpFn };
		// A bundler can hand back the CommonJS export itself rather than a namespace.
		cachedSharp = mod.default ?? (mod as unknown as SharpFn);
		return cachedSharp;
	} catch (err) {
		throw new Error(
			'Image transcoding requires `sharp` to be installed. Add it as a dependency in your provider package.',
			{ cause: err }
		);
	}
}
