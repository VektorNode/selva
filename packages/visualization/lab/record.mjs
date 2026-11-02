import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

const [url, name] = process.argv.slice(2);
if (!url || !name) {
	console.error('Usage: pnpm lab:record <session url> <scene name>');
	process.exit(1);
}

const outDir = fileURLToPath(new URL('../../../fixtures/viewer-scenes/', import.meta.url));
await mkdir(outDir, { recursive: true });

// Each solve announces `binaryBatchCount`, then sends that many mesh frames, so the frames after
// the newest announcement are the whole scene as it stands now.
let expected = 0;
let frames = [];

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
page.on('websocket', (socket) =>
	socket.on('framereceived', ({ payload }) => {
		if (typeof payload === 'string') {
			const count = /"binaryBatchCount":\s*(\d+)/.exec(payload)?.[1];
			if (count == null) return;
			expected = Number(count);
			frames = [];
		} else if (frames.length < expected) {
			frames.push(payload);
		}
	})
);

await page.goto(url);
console.log('Change the scene in the page if needed. Recording the latest solve in 8 s.');
await page.waitForTimeout(8000);
await browser.close();

if (frames.length === 0) {
	console.error('No mesh frames arrived: is the bridge enabled, and the URL current?');
	process.exit(1);
}
for (const [index, frame] of frames.entries()) {
	const suffix = frames.length > 1 ? `-${index}` : '';
	await writeFile(`${outDir}${name}${suffix}.slvm`, frame);
}
console.log(`Wrote ${frames.length} file(s) for ${name} to ${outDir}`);
