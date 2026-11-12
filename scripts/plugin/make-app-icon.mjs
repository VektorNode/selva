#!/usr/bin/env node

// Renders Selva's logo (packages/plugin-ui/static/favicon/favicon.svg) into
// Plugin/Selva.App/selva.ico, the icon of SelvaApp.exe and SelvaSetup.exe.
// Windows takes no SVG for an exe, a window or the taskbar, so every size it asks
// for at 100% to 250% scaling is drawn from the SVG here instead of being scaled
// from a neighbour. Rerun after the logo changes and commit the result:
//
//   node scripts/plugin/make-app-icon.mjs

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { projectRoot, renderLogo } from './shared.mjs';

const SIZES = [16, 20, 24, 32, 40, 48, 60, 64, 72, 96, 128, 256];

const render = async (size) => (await renderLogo(size)).ensureAlpha();

// ICO frame as a device-independent bitmap: a 40-byte BITMAPINFOHEADER whose height counts the
// colour rows and the mask rows, 32-bit BGRA rows bottom-up, then a 1-bit mask padded to 32 bits
// per row. The mask is all zero: alpha carries the transparency.
async function dibFrame(size) {
	const rgba = await (await render(size)).raw().toBuffer();
	const header = Buffer.alloc(40);
	header.writeUInt32LE(40, 0);
	header.writeInt32LE(size, 4);
	header.writeInt32LE(size * 2, 8);
	header.writeUInt16LE(1, 12);
	header.writeUInt16LE(32, 14);
	header.writeUInt32LE(size * size * 4, 20);

	const pixels = Buffer.alloc(size * size * 4);
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const from = (y * size + x) * 4;
			const to = ((size - 1 - y) * size + x) * 4;
			pixels[to] = rgba[from + 2];
			pixels[to + 1] = rgba[from + 1];
			pixels[to + 2] = rgba[from];
			pixels[to + 3] = rgba[from + 3];
		}
	}

	const mask = Buffer.alloc(Math.ceil(size / 32) * 4 * size);
	return Buffer.concat([header, pixels, mask]);
}

// The 256 px frame is stored as a PNG, as Windows itself does: a bitmap that size is 260 KB.
const frames = await Promise.all(
	SIZES.map(async (size) => ({
		size,
		data: size === 256 ? await (await render(size)).png().toBuffer() : await dibFrame(size)
	}))
);

const directory = Buffer.alloc(6 + frames.length * 16);
directory.writeUInt16LE(1, 2);
directory.writeUInt16LE(frames.length, 4);
let offset = directory.length;
frames.forEach(({ size, data }, index) => {
	const entry = 6 + index * 16;
	// A byte each, where 0 means 256.
	directory[entry] = size % 256;
	directory[entry + 1] = size % 256;
	directory.writeUInt16LE(1, entry + 4);
	directory.writeUInt16LE(32, entry + 6);
	directory.writeUInt32LE(data.length, entry + 8);
	directory.writeUInt32LE(offset, entry + 12);
	offset += data.length;
});

const target = join(projectRoot, 'Plugin/Selva.App/selva.ico');
writeFileSync(target, Buffer.concat([directory, ...frames.map((frame) => frame.data)]));
console.log(`${target}: ${SIZES.join(', ')} px, ${offset} bytes`);
