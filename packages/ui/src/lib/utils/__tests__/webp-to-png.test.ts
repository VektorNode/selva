import { describe, expect, it } from 'vitest';
import { acceptsFileEnding, isWebp, shouldConvertWebp } from '../webp-to-png';

describe('shouldConvertWebp', () => {
	const imageFormats = ['.png', '.jpg', '.jpeg', '.webp', '.svg'];

	it('converts a WebP for an input that also takes PNG', () => {
		expect(shouldConvertWebp('.webp', imageFormats)).toBe(true);
	});

	it('leaves a WebP alone when PNG is not an accepted value', () => {
		expect(shouldConvertWebp('.webp', ['.webp'])).toBe(false);
		expect(shouldConvertWebp('.webp', [])).toBe(false);
	});

	it('leaves other formats alone', () => {
		expect(shouldConvertWebp('.png', imageFormats)).toBe(false);
		expect(shouldConvertWebp('.jpg', imageFormats)).toBe(false);
	});
});

describe('acceptsFileEnding', () => {
	it('accepts a WebP for an input that takes PNG but not WebP', () => {
		expect(acceptsFileEnding('.webp', ['.png'])).toBe(true);
	});

	it('rejects a WebP when neither WebP nor PNG is accepted', () => {
		expect(acceptsFileEnding('.webp', ['.jpg'])).toBe(false);
	});

	it('accepts listed endings in any case, and anything when nothing is listed', () => {
		expect(acceptsFileEnding('.JPG', ['.jpg'])).toBe(true);
		expect(acceptsFileEnding('.gh', [])).toBe(true);
		expect(acceptsFileEnding('.gh', ['.jpg'])).toBe(false);
	});
});

describe('isWebp', () => {
	const riff = (format: string) =>
		new Uint8Array(
			[...'RIFF']
				.map((c) => c.charCodeAt(0))
				.concat(
					[0, 0, 0, 0],
					[...format].map((c) => c.charCodeAt(0)),
					[1, 2, 3]
				)
		);

	it('recognises WebP bytes whatever the blob claims to be', async () => {
		expect(await isWebp(new Blob([riff('WEBP')]))).toBe(true);
		expect(await isWebp(new Blob([riff('WEBP')], { type: 'application/octet-stream' }))).toBe(true);
	});

	it('trusts a WebP MIME type', async () => {
		expect(await isWebp(new Blob(['x'], { type: 'image/webp' }))).toBe(true);
	});

	it('rejects other RIFF formats and short or unrelated files', async () => {
		expect(await isWebp(new Blob([riff('WAVE')]))).toBe(false);
		expect(await isWebp(new Blob(['RIFF']))).toBe(false);
		expect(
			await isWebp(new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' }))
		).toBe(false);
	});
});
