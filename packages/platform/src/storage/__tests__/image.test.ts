import { crc32, deflateSync } from 'node:zlib';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { ProviderError } from '../../errors.js';
import { MAX_CONCURRENT_TRANSCODES, transcodeImageIfNeeded, withTranscodeSlot } from '../image.js';

const size = async (data: Uint8Array) => {
	const { width, height } = await sharp(Buffer.from(data)).metadata();
	return { width, height };
};

const blank = (width: number, height: number) =>
	sharp({ create: { width, height, channels: 3, background: '#fff' } });

function pngChunk(type: string, data: Buffer): Buffer {
	const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(body));
	return Buffer.concat([length, body, crc]);
}

/** A valid PNG header over almost no data: what a bomb says, with no pixels to pay for. */
function pngHeaderClaiming(width: number, height: number): Uint8Array {
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(height, 4);
	header.set([8, 2, 0, 0, 0], 8);
	return new Uint8Array(
		Buffer.concat([
			Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
			pngChunk('IHDR', header),
			pngChunk('IDAT', deflateSync(Buffer.alloc(16))),
			pngChunk('IEND', Buffer.alloc(0))
		])
	);
}

async function rejection(promise: Promise<unknown>): Promise<ProviderError> {
	const err = await promise.then(
		() => null,
		(e: unknown) => e
	);
	expect(err).toBeInstanceOf(ProviderError);
	return err as ProviderError;
}

// Building a big fixture is real CPU work, and CI runners are slower than a laptop.
describe('transcodeImageIfNeeded limits', { timeout: 30_000 }, () => {
	it('refuses a pixel bomb from its header, without decoding it', async () => {
		const err = await rejection(
			transcodeImageIfNeeded(pngHeaderClaiming(9000, 9000), 'image/png', 'a/b.png')
		);
		expect(err.statusCode).toBe(422);
		expect(err.message).toMatch(/too many pixels/);
	});

	it('refuses an SVG with a huge canvas quickly', async () => {
		const rects = Array.from(
			{ length: 200 },
			() => `<rect width="8000" height="8000" filter="url(#f)"/>`
		).join('');
		const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="8000" height="8000">
			<filter id="f"><feGaussianBlur stdDeviation="500"/></filter>${rects}</svg>`;

		const started = Date.now();
		const err = await rejection(
			transcodeImageIfNeeded(new TextEncoder().encode(svg), 'image/svg+xml', 'a/logo.svg')
		);

		expect(err.statusCode).toBe(422);
		expect(Date.now() - started).toBeLessThan(5000);
	});

	it('refuses SVG declared as PNG', async () => {
		const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>';
		const err = await rejection(
			transcodeImageIfNeeded(new TextEncoder().encode(svg), 'image/png', 'a/b.png')
		);
		expect(err.statusCode).toBe(422);
	});

	it('answers 422 for bytes that are not an image', async () => {
		const err = await rejection(
			transcodeImageIfNeeded(new TextEncoder().encode('not an image'), 'image/png', 'a/b.png')
		);
		expect(err.statusCode).toBe(422);
	});

	it('runs a bounded number of transcodes at once', async () => {
		let active = 0;
		let peak = 0;
		await Promise.all(
			Array.from({ length: MAX_CONCURRENT_TRANSCODES * 4 }, () =>
				withTranscodeSlot(async () => {
					active += 1;
					peak = Math.max(peak, active);
					await new Promise((resolve) => setTimeout(resolve, 1));
					active -= 1;
				})
			)
		);
		expect(peak).toBe(MAX_CONCURRENT_TRANSCODES);
	});

	it('frees its slot when a transcode fails', async () => {
		const failing = Array.from({ length: MAX_CONCURRENT_TRANSCODES * 2 }, () =>
			withTranscodeSlot(async () => {
				throw new Error('boom');
			}).catch(() => {})
		);
		await Promise.all(failing);
		await expect(withTranscodeSlot(async () => 'ran')).resolves.toBe('ran');
	});
});

describe('transcodeImageIfNeeded output', { timeout: 30_000 }, () => {
	it('applies EXIF orientation', async () => {
		const rotated = await blank(40, 20).jpeg().withMetadata({ orientation: 6 }).toBuffer();
		const out = await transcodeImageIfNeeded(new Uint8Array(rotated), 'image/jpeg', 'a/b.jpg');
		expect(await size(out.data)).toEqual({ width: 20, height: 40 });
	});

	it('caps height as well as width', async () => {
		const tall = await blank(2000, 25000).png({ compressionLevel: 9 }).toBuffer();
		const out = await transcodeImageIfNeeded(new Uint8Array(tall), 'image/png', 'a/b.png');
		expect(await size(out.data)).toEqual({ width: 96, height: 1200 });
	});

	it('handles a sliver too tall for WebP', async () => {
		const sliver = await blank(100, 60000).png({ compressionLevel: 9 }).toBuffer();
		const out = await transcodeImageIfNeeded(new Uint8Array(sliver), 'image/png', 'a/b.png');
		expect((await size(out.data)).height).toBe(1200);
	});

	it('leaves a small image at its own size', async () => {
		const small = await blank(30, 20).png().toBuffer();
		const out = await transcodeImageIfNeeded(new Uint8Array(small), 'image/png', 'a/b.png');
		expect(await size(out.data)).toEqual({ width: 30, height: 20 });
	});

	it('still rasterizes a declared SVG', async () => {
		const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>';
		const out = await transcodeImageIfNeeded(
			new TextEncoder().encode(svg),
			'image/svg+xml',
			'a/logo.svg'
		);
		expect(out).toMatchObject({ contentType: 'image/webp', path: 'a/logo.webp' });
	});
});

describe('content type against extension', () => {
	it('passes a PDF named .png through untouched', async () => {
		const pdf = new TextEncoder().encode('%PDF-1.7');
		const out = await transcodeImageIfNeeded(pdf, 'application/pdf', 'a/x.png');
		expect(out).toEqual({ data: pdf, contentType: 'application/pdf', path: 'a/x.png' });
	});

	it('trusts the extension when the type says nothing', async () => {
		const png = await blank(10, 10).png().toBuffer();
		const out = await transcodeImageIfNeeded(
			new Uint8Array(png),
			'application/octet-stream',
			'a/b.png'
		);
		expect(out.contentType).toBe('image/webp');
	});
});
