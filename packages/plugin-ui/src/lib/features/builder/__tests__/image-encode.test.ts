import { describe, expect, it } from 'vitest';
import { encodeThumbnail, MAX_THUMBNAIL_BYTES, type ThumbnailEncoder } from '../image-encode';

/** An encoder whose output size depends on format and quality, like a real canvas. */
function fakeEncoder(sizeOf: (type: string, quality: number) => number, supportsWebp = true) {
	const calls: { type: string; quality: number }[] = [];
	const encoder: ThumbnailEncoder = async (type, quality) => {
		calls.push({ type, quality });
		// Safari's canvas can't write WebP and quietly hands back a PNG instead.
		const actual = type === 'image/webp' && !supportsWebp ? 'image/png' : type;
		return new Blob([new Uint8Array(sizeOf(actual, quality))], { type: actual });
	};
	return { encoder, calls };
}

describe('encodeThumbnail', () => {
	it('takes the first WebP that fits', async () => {
		const { encoder, calls } = fakeEncoder(() => 8_000);

		const result = await encodeThumbnail(encoder, { opaque: true });

		expect(result).toMatchObject({ ok: true, type: 'image/webp' });
		expect(calls).toEqual([{ type: 'image/webp', quality: 0.72 }]);
	});

	it('lowers the quality until the image fits', async () => {
		const { encoder, calls } = fakeEncoder((_, q) => (q > 0.55 ? 40_000 : 20_000));

		const result = await encodeThumbnail(encoder, { opaque: true });

		expect(result).toMatchObject({ ok: true, type: 'image/webp' });
		expect(calls.at(-1)?.quality).toBe(0.5);
	});

	it('falls back to JPEG for an opaque image when the browser cannot write WebP', async () => {
		const { encoder } = fakeEncoder(() => 8_000, false);

		const result = await encodeThumbnail(encoder, { opaque: true });

		expect(result).toMatchObject({ ok: true, type: 'image/jpeg' });
	});

	it('keeps transparency as PNG when the browser cannot write WebP', async () => {
		const { encoder } = fakeEncoder(() => 8_000, false);

		const result = await encodeThumbnail(encoder, { opaque: false });

		expect(result).toMatchObject({ ok: true, type: 'image/png' });
	});

	it('falls back when the browser writes nothing at all for WebP', async () => {
		const encoder: ThumbnailEncoder = async (type, quality) =>
			type === 'image/webp'
				? null
				: new Blob([new Uint8Array(Math.round(8_000 * quality))], { type });

		const result = await encodeThumbnail(encoder, { opaque: true });

		expect(result).toMatchObject({ ok: true, type: 'image/jpeg' });
	});

	it('reports the smallest size it reached when nothing fits', async () => {
		const { encoder } = fakeEncoder((_, q) => Math.round(100_000 * q));

		const result = await encodeThumbnail(encoder, { opaque: true });

		expect(result).toEqual({ ok: false, smallestBytes: 40_000 });
		expect(MAX_THUMBNAIL_BYTES).toBeLessThan(40_000);
	});
});
