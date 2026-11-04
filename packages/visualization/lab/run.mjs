import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const { values } = parseArgs({
	options: {
		scene: { type: 'string', default: 'lamp' },
		look: { type: 'string', default: 'studio' },
		label: { type: 'string', default: 'latest' },
		gpu: { type: 'string', default: 'auto' },
		frames: { type: 'string' },
		without: { type: 'string' },
		breakdown: { type: 'boolean', default: false },
		orbit: { type: 'string' },
		background: { type: 'string' },
		transition: { type: 'boolean', default: false },
		turn: { type: 'string' },
		distance: { type: 'string' },
		phone: { type: 'boolean', default: false },
		bench: { type: 'boolean', default: false }
	}
});

// Headless Chrome falls back to software rendering unless told otherwise, and software numbers
// say nothing about any real device.
const GPU_FLAGS = {
	auto: ['--use-angle=d3d11', '--ignore-gpu-blocklist'],
	intel: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--force_low_power_gpu'],
	software: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
};

const DESKTOP = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 };
const PHONE = {
	viewport: { width: 390, height: 844 },
	deviceScaleFactor: 3,
	hasTouch: true,
	isMobile: true
};

const outDir = fileURLToPath(new URL(`./out/${values.label}/`, import.meta.url));
await mkdir(outDir, { recursive: true });

const server = await createServer({
	configFile: fileURLToPath(new URL('./vite.config.js', import.meta.url)),
	server: { port: 0 },
	logLevel: 'error'
});
await server.listen();
const { port } = server.httpServer.address();

const browser = await chromium.launch({
	channel: 'chrome',
	headless: true,
	args: ['--headless=new', ...GPU_FLAGS[values.gpu]]
});

// One run per feature removed, so the difference from the first is what that feature costs.
const variants = values.breakdown
	? ['', 'ao', 'bloom', 'shadows', 'emissive', 'finishes', 'ao,bloom']
	: [values.without ?? ''];

const results = [];
const combos = values.scene
	.split(',')
	.flatMap((scene) => values.look.split(',').map((look) => [scene, look]));
for (const [scene, look] of combos) {
	let full;
	for (const without of variants) {
		const page = await (await browser.newContext(values.phone ? PHONE : DESKTOP)).newPage();
		page.on('pageerror', (error) => console.error(`${scene}/${look}:`, error.message));

		const query = new URLSearchParams({ scene, look, manual: '' });
		for (const key of ['frames', 'turn', 'distance', 'orbit', 'background']) {
			if (values[key] != null) query.set(key, values[key]);
		}
		if (without) query.set('without', without);
		await page.goto(`http://localhost:${port}/?${query}`);
		// Polls on a timer: the default polls with requestAnimationFrame, which the lab has taken over.
		await page.waitForFunction(() => document.title !== 'Viewer lab', null, {
			polling: 100,
			timeout: 60000
		});

		const name = [scene, look, values.phone && 'phone', without && `no-${without}`]
			.filter(Boolean)
			.join('-');
		if (values.bench || values.breakdown) {
			const result = await page.evaluate(() => window.lab.bench());
			full ??= result.orbitMedianMs;
			const savedMs = Math.round((full - result.orbitMedianMs) * 10) / 10;
			results.push({ name, ...result, savedMs });
		}
		if (values.transition) {
			const changes = await page.evaluate(() => window.lab.transition());
			console.log(name, 'largest step', Math.max(...changes), '%, per frame:', changes.join(' '));
		}
		const image = await page.evaluate(() => window.lab.shot());
		await writeFile(`${outDir}${name}.png`, Buffer.from(image, 'base64'));
		await page.context().close();
	}
}

await browser.close();
await server.close();

if (results.length) {
	const { gpu, look: _look, ...columns } = results[0];
	console.table(results, Object.keys(columns));
	console.log(gpu);
	await writeFile(`${outDir}bench.json`, JSON.stringify(results, null, '\t'));
}
console.log(`Images in ${outDir}`);
