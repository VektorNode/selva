// Thumbnails for value-list tiles. They are base64'd into the schema inside the .gh, and the
// plugin's schema history backups copy it again, so each one is cut down hard.

/** Shown at about 96 CSS px in a tile; twice that stays sharp on a high-density screen. */
export const THUMBNAIL_PX = 192;
export const MAX_THUMBNAIL_BYTES = 24 * 1024;

const QUALITIES = [0.72, 0.6, 0.5, 0.4];

/** Encodes the drawn thumbnail; resolves to whatever format the browser actually wrote. */
export type ThumbnailEncoder = (type: string, quality: number) => Promise<Blob | null>;

export type ThumbnailResult =
	{ ok: true; blob: Blob; type: string } | { ok: false; smallestBytes: number };

export async function encodeThumbnail(
	encode: ThumbnailEncoder,
	{ opaque }: { opaque: boolean }
): Promise<ThumbnailResult> {
	let smallest = Infinity;

	const attempt = async (
		type: string,
		qualities: number[]
	): Promise<ThumbnailResult | 'unsupported'> => {
		let wrote = false;
		for (const quality of qualities) {
			const blob = await encode(type, quality);
			if (!blob) continue;
			// Safari's canvas can't write WebP and hands back a PNG without saying so.
			if (blob.type !== type) return 'unsupported';
			wrote = true;
			smallest = Math.min(smallest, blob.size);
			if (blob.size <= MAX_THUMBNAIL_BYTES) return { ok: true, blob, type };
		}
		return wrote ? { ok: false, smallestBytes: smallest } : 'unsupported';
	};

	const webp = await attempt('image/webp', QUALITIES);
	if (webp !== 'unsupported') return webp;

	const fallback = opaque
		? await attempt('image/jpeg', QUALITIES)
		: await attempt('image/png', [1]);
	return fallback === 'unsupported' ? { ok: false, smallestBytes: smallest } : fallback;
}

/**
 * Center-crops the picked image to a square thumbnail. The Rhino panel's picker returns a File
 * without a MIME type, so the image is judged by decoding it, not by `file.type`.
 */
export async function drawThumbnail(
	file: Blob
): Promise<{ encode: ThumbnailEncoder; opaque: boolean }> {
	const bitmap = await createImageBitmap(file);
	const side = Math.min(bitmap.width, bitmap.height);
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = THUMBNAIL_PX;
	const ctx = canvas.getContext('2d', { willReadFrequently: true });
	if (!ctx) throw new Error('This browser cannot draw images.');
	ctx.drawImage(
		bitmap,
		(bitmap.width - side) / 2,
		(bitmap.height - side) / 2,
		side,
		side,
		0,
		0,
		THUMBNAIL_PX,
		THUMBNAIL_PX
	);
	bitmap.close();

	const alpha = ctx.getImageData(0, 0, THUMBNAIL_PX, THUMBNAIL_PX).data;
	let opaque = true;
	for (let i = 3; i < alpha.length; i += 4) {
		if (alpha[i] < 255) {
			opaque = false;
			break;
		}
	}

	const encode: ThumbnailEncoder = (type, quality) =>
		new Promise((resolve) => canvas.toBlob(resolve, type, quality));
	return { encode, opaque };
}

export function blobToDataUri(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result));
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(blob);
	});
}
