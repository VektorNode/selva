import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

const [before, after] = process.argv.slice(2);
if (!before || !after) {
	console.error('Usage: pnpm lab:diff <label> <label>');
	process.exit(1);
}

const out = (label) => fileURLToPath(new URL(`./out/${label}/`, import.meta.url));
const asDataUrl = async (path) =>
	`data:image/png;base64,${(await readFile(path)).toString('base64')}`;

const compare = async ([a, b]) => {
	const load = (src) =>
		new Promise((resolve) => {
			const image = new Image();
			image.onload = () => resolve(image);
			image.src = src;
		});
	const [first, second] = await Promise.all([load(a), load(b)]);
	const canvas = new OffscreenCanvas(first.width, first.height);
	const context = canvas.getContext('2d');
	const pixels = (image) => {
		context.drawImage(image, 0, 0);
		return context.getImageData(0, 0, first.width, first.height);
	};
	const left = pixels(first).data;
	const right = pixels(second).data;

	// Amplified, because the changes that matter are often too faint to see at full scale.
	const AMPLIFY = 8;
	const output = new ImageData(first.width, first.height);
	const errors = new Float32Array(first.width * first.height);
	for (let i = 0; i < errors.length; i++) {
		const at = i * 4;
		let error = 0;
		for (let channel = 0; channel < 3; channel++) {
			const difference = Math.abs(left[at + channel] - right[at + channel]);
			output.data[at + channel] = Math.min(255, difference * AMPLIFY);
			error += difference / 3;
		}
		output.data[at + 3] = 255;
		errors[i] = error;
	}
	context.putImageData(output, 0, 0);

	const sorted = errors.slice().sort();
	const mean = errors.reduce((sum, error) => sum + error, 0) / errors.length;
	const blob = await canvas.convertToBlob({ type: 'image/png' });
	const bytes = new Uint8Array(await blob.arrayBuffer());
	return {
		meanPercent: Math.round((mean / 255) * 1e4) / 100,
		worst1Percent: Math.round((sorted[Math.floor(errors.length * 0.99)] / 255) * 1e4) / 100,
		changedPercent: Math.round((errors.filter((e) => e > 2).length / errors.length) * 1e4) / 100,
		image: btoa(bytes.reduce((text, byte) => text + String.fromCharCode(byte), ''))
	};
};

const diffDir = out(`diff-${before}-${after}`);
await mkdir(diffDir, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
const names = (await readdir(out(before))).filter((name) => name.endsWith('.png'));
const wanted = new Set(await readdir(out(after)));

const results = [];
for (const name of names.filter((each) => wanted.has(each))) {
	const pair = [await asDataUrl(out(before) + name), await asDataUrl(out(after) + name)];
	const { image, ...result } = await page.evaluate(compare, pair);
	await writeFile(diffDir + name, Buffer.from(image, 'base64'));
	results.push({ name, ...result });
}
await browser.close();

console.table(results);
console.log(`Amplified differences in ${diffDir}`);
