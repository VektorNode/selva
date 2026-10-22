/**
 * Generate a small equirectangular Radiance (.hdr) environment for the examples.
 *
 * The gradient is deliberately *studio-unfriendly*: a bright warm sky in the upper hemisphere and a
 * near-black floor in the lower hemisphere. That is exactly the HDR shape that leaves the undersides
 * of products in detail-swallowing shadow — so the viewer demo's Lighting controls (hemisphere fill,
 * environment intensity, exposure) have something real to fix.
 *
 * Writes a flat (uncompressed) RGBE .hdr, which every HDR loader — including three's — reads. No image
 * dependencies: RGBE packing is a few lines. Run: `node scripts/make-demo-hdr.mjs`.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const WIDTH = 512;
const HEIGHT = 256;
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../examples/baseHDR.hdr');

/** Pack a linear float RGB triple into a 4-byte RGBE pixel (shared exponent). */
function toRGBE(r, g, b) {
	const max = Math.max(r, g, b);
	if (max < 1e-8) return [0, 0, 0, 0];
	// frexp: max = mantissa * 2^exp, mantissa in [0.5, 1)
	let exp = Math.ceil(Math.log2(max));
	const scale = 255.999 / Math.pow(2, exp);
	return [
		Math.max(0, Math.min(255, Math.floor(r * scale))),
		Math.max(0, Math.min(255, Math.floor(g * scale))),
		Math.max(0, Math.min(255, Math.floor(b * scale))),
		exp + 128
	];
}

const header = Buffer.from(
	`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${HEIGHT} +X ${WIDTH}\n`,
	'ascii'
);
const body = Buffer.alloc(WIDTH * HEIGHT * 4);

for (let y = 0; y < HEIGHT; y++) {
	// v: 0 at the top (sky) → 1 at the bottom (floor).
	const v = y / (HEIGHT - 1);
	// Smooth sky→floor falloff. Sky is a bright warm dome (~6 nits), floor is nearly black (~0.03)
	// — a big dynamic range so the lower hemisphere genuinely under-lights the model.
	const sky = Math.pow(1 - v, 2.2);
	const skyR = 6.0 * sky + 0.03;
	const skyG = 5.4 * sky + 0.03;
	const skyB = 4.6 * sky + 0.03;
	// A soft off-center "sun" hotspot in the upper sky, so reflections have a highlight to catch.
	for (let x = 0; x < WIDTH; x++) {
		const u = x / (WIDTH - 1);
		const du = u - 0.32;
		const dv = v - 0.18;
		const sun = Math.exp(-((du * du) / 0.004 + (dv * dv) / 0.002)) * 30.0;
		const [r, g, bb, e] = toRGBE(skyR + sun, skyG + sun * 0.95, skyB + sun * 0.8);
		const i = (y * WIDTH + x) * 4;
		body[i] = r;
		body[i + 1] = g;
		body[i + 2] = bb;
		body[i + 3] = e;
	}
}

fs.writeFileSync(OUT, Buffer.concat([header, body]));
console.log(`Wrote ${OUT} (${WIDTH}x${HEIGHT}, ${(body.length / 1024).toFixed(0)} KiB body)`);
