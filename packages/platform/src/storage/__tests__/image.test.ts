import { crc32, deflateSync } from 'node:zlib';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import { ProviderError } from '../../errors/index.js';
import {
	MAX_CONCURRENT_TRANSCODES,
	MAX_WAITING_TRANSCODES,
	transcodeImageIfNeeded,
	withTranscodeSlot
} from '../image.js';

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

const svgDoc = (body: string, prolog = '') =>
	`${prolog}<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40">${body}</svg>`;
const utf8 = (text: string) => new TextEncoder().encode(text);

/** Holds `count` transcode slots (or queue places) until the returned function is called. */
function holdSlots(count: number): () => Promise<void> {
	let open!: () => void;
	const gate = new Promise<void>((resolve) => (open = resolve));
	const held = Array.from({ length: count }, () => withTranscodeSlot(() => gate));
	return async () => {
		open();
		await Promise.all(held);
	};
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

	it('refuses a strip too long on one side, from its header', async () => {
		const err = await rejection(
			transcodeImageIfNeeded(pngHeaderClaiming(1, 59_000_000), 'image/png', 'a/b.png')
		);
		expect(err.statusCode).toBe(422);
		expect(err.message).toMatch(/16384 pixels on a side/);
	});

	it('refuses an SVG with a huge canvas quickly', async () => {
		const rects = '<rect width="8000" height="8000" fill-opacity="0.5"/>'.repeat(200);
		const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="8000" height="8000">${rects}</svg>`;

		const started = Date.now();
		const err = await rejection(
			transcodeImageIfNeeded(new TextEncoder().encode(svg), 'image/svg+xml', 'a/logo.svg')
		);

		expect(err.statusCode).toBe(422);
		expect(Date.now() - started).toBeLessThan(5000);
	});

	// Each draws in librsvg without sharp's timeout firing, or pulls in something that does.
	const nested = svgDoc('<rect width="20" height="20" style="filter: blur(3px)"/>');
	it.each([
		[
			'a <filter> element',
			svgDoc(
				'<filter id="f"><feGaussianBlur stdDeviation="3"/></filter><rect width="20" height="20" filter="url(#f)"/>'
			),
			/filters/
		],
		['a CSS filter', nested, /filters/],
		[
			'a filter spelled with a character reference',
			svgDoc('<rect width="20" height="20" style="fil&#116;er: blur(3px)"/>'),
			/filters/
		],
		[
			'a filter spelled with a CSS escape',
			svgDoc('<rect width="20" height="20" style="fil\\74 er: blur(3px)"/>'),
			/filters/
		],
		[
			'a <style> split by a child element',
			svgDoc('<style>rect{fil<g/>ter: blur(3px)}</style><rect width="20" height="20"/>'),
			/filters/
		],
		[
			'nested <use>',
			svgDoc(
				'<defs><g id="a"><rect width="20" height="20"/></g><g id="b"><use href="#a"/><use\nhref="#a"/></g></defs><use href="#b"/>'
			),
			/<use>, masks/
		],
		[
			'a mask',
			svgDoc(
				'<mask id="m"><rect width="20" height="20" fill="#fff"/></mask><rect width="20" height="20" mask="url(#m)"/>'
			),
			/<use>, masks/
		],
		[
			'a marker',
			svgDoc(
				'<marker id="k"><rect width="2" height="2"/></marker><path d="M0 0 L9 9 L19 0" marker-mid="url(#k)"/>'
			),
			/<use>, masks/
		],
		[
			'a dash pattern',
			svgDoc('<path d="M0 0 L39 39" stroke="#000" stroke-dasharray="0.01 0.01"/>'),
			/<use>, masks/
		],
		[
			'an entity',
			svgDoc(
				'&f;<rect width="20" height="20" filter="url(#f)"/>',
				`<!DOCTYPE svg [<!ENTITY f "<filter id='f'><feGaussianBlur stdDeviation='3'/></filter>">]>`
			),
			/entities/
		],
		[
			'a data: URL',
			svgDoc(
				`<image width="40" height="40" href="da&#9;ta:image/svg+xml;base64,${Buffer.from(nested).toString('base64')}"/>`
			),
			/data: URLs/
		],
		['UTF-16 text', Buffer.from(svgDoc(''), 'utf16le'), /UTF-8/],
		['more than 1 MB', svgDoc(' '.repeat(1024 * 1024)), /larger than 1024 KB/],
		['more than 10000 elements', svgDoc('<g/>'.repeat(10_001)), /10000 elements/]
	])('refuses an SVG with %s before rendering it', async (_, svg, problem) => {
		const bytes = typeof svg === 'string' ? utf8(svg) : new Uint8Array(svg);
		const err = await rejection(transcodeImageIfNeeded(bytes, 'image/svg+xml', 'a/logo.svg'));
		expect(err.statusCode).toBe(422);
		expect(err.message).toMatch(problem);
	});

	it('refuses SVG declared as PNG without parsing it', async () => {
		const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>';
		const err = await rejection(transcodeImageIfNeeded(utf8(svg), 'image/png', 'a/b.png'));
		expect(err.statusCode).toBe(422);
		expect(err.message).toMatch(/needs the image\/svg\+xml type/);
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

	it('answers 503 once the queue is full', async () => {
		const release = holdSlots(MAX_CONCURRENT_TRANSCODES + MAX_WAITING_TRANSCODES);
		const err = await rejection(withTranscodeSlot(async () => 'ran'));
		expect(err.statusCode).toBe(503);
		await release();
	});

	it('answers 503 when no slot frees up in time', async () => {
		vi.useFakeTimers();
		try {
			const release = holdSlots(MAX_CONCURRENT_TRANSCODES);
			const waiting = rejection(withTranscodeSlot(async () => 'ran'));
			await vi.runOnlyPendingTimersAsync();
			expect((await waiting).statusCode).toBe(503);
			await release();
		} finally {
			vi.useRealTimers();
		}
	});
});

describe('transcodeImageIfNeeded output', { timeout: 30_000 }, () => {
	it('applies EXIF orientation', async () => {
		const rotated = await blank(40, 20).jpeg().withMetadata({ orientation: 6 }).toBuffer();
		const out = await transcodeImageIfNeeded(new Uint8Array(rotated), 'image/jpeg', 'a/b.jpg');
		expect(await size(out.data)).toEqual({ width: 20, height: 40 });
	});

	it.each([
		[2000, 16_000, { width: 150, height: 1200 }],
		// Taller than WebP's 16383-pixel limit: it only encodes once resized.
		[100, 16_384, { width: 7, height: 1200 }]
	])('caps height as well as width: %i x %i', async (width, height, expected) => {
		const tall = await blank(width, height).png({ compressionLevel: 9 }).toBuffer();
		const out = await transcodeImageIfNeeded(new Uint8Array(tall), 'image/png', 'a/b.png');
		expect(await size(out.data)).toEqual(expected);
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

	it('reads the content type case-insensitively', async () => {
		const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>';
		const out = await transcodeImageIfNeeded(utf8(svg), 'IMAGE/SVG+XML', 'orgs/x/logo.webp');
		expect(out).toMatchObject({ contentType: 'image/webp', path: 'orgs/x/logo.webp' });
	});
});
