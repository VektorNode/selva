#!/usr/bin/env node

/**
 * Screenshots a definition as Selva shows it: the plugin's preview page for a running UI Bridge,
 * the whole page and the 3D view in each look, for one or more sets of input values.
 *
 *   node scripts/plugin/snap-preview.mjs --url '<UI Bridge URL output>' [--out dir] [--looks showcase,night]
 *        [--values values.json] [--size 1600x1000]
 *
 * values.json: [{ "name": "evening", "values": { "Evening lights": true, "Span": 22 } }, ...]. Keys
 * are input nicknames or ids; a value list takes its option's value. Each set is sent over the
 * bridge like a form edit, and the page shows the solve it starts.
 *
 * Pass the whole URL: the page authenticates with the secret in its fragment.
 */

import { createRequire } from 'module';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// plugin-ui owns the Playwright install, along with its browsers.
const { chromium } = createRequire(path.join(root, 'packages/plugin-ui/package.json'))(
	'@playwright/test'
);

function args() {
	const out = { out: 'snapshots', looks: '', size: '1600x1000' };
	const argv = process.argv.slice(2);
	for (let i = 0; i < argv.length; i += 2) out[argv[i].replace(/^--/, '')] = argv[i + 1];
	if (!out.url) {
		console.error(
			"Usage: node scripts/plugin/snap-preview.mjs --url '<UI Bridge URL>' [--out dir] [--looks showcase,night] [--values values.json]"
		);
		process.exit(2);
	}
	return out;
}

const LOOK_LABELS = {
	technical: 'Technical',
	studio: 'Studio',
	showcase: 'Showcase',
	arctic: 'Arctic',
	xray: 'X-Ray',
	lineart: 'Line Art',
	wireframe: 'Wireframe'
};

const opts = args();
const bridge = new URL(opts.url);
const session = bridge.searchParams.get('session');
const [width, height] = opts.size.split('x').map(Number);
const looks = opts.looks ? opts.looks.split(',') : [];
const sets = opts.values
	? JSON.parse(readFileSync(opts.values, 'utf8'))
	: [{ name: 'default', values: null }];
mkdirSync(opts.out, { recursive: true });

const preview = new URL(bridge);
preview.pathname = '/preview';

// Headless Chromium has no GPU; without SwiftShader the viewer's WebGL canvas stays blank.
const browser = await chromium.launch({
	args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
});
const page = await browser.newPage({ viewport: { width, height } });
const log = [];
page.on('console', (m) => m.type() === 'error' && log.push(m.text()));

async function settle() {
	// A solve shows "Solving…" until its outputs land; a fast one may never show it.
	await page.getByText(/Solving/).waitFor({ state: 'hidden', timeout: 120_000 });
	// Give the viewer a few frames to upload and draw what arrived.
	await page.waitForTimeout(1500);
}

// Night is a switch on top of the day look, not one of the looks.
let night = false;

async function setLook(look) {
	// The viewer's toolbar stays tucked under its bottom edge until the pointer comes near.
	const box = await page.getByTestId('viewer-canvas').boundingBox();
	await page.mouse.move(box.x + box.width / 2, box.y + box.height - 20);
	await page.waitForTimeout(600);
	const toggleNight = async () => {
		await page.getByTestId('viewer-canvas').focus();
		await page.keyboard.press('n');
		night = !night;
	};
	if (look === 'night') {
		if (!night) await toggleNight();
	} else {
		if (night) await toggleNight();
		await page.getByRole('button', { name: 'Display' }).click();
		await page.getByRole('menuitemradio', { name: LOOK_LABELS[look] ?? look }).click();
		await page.keyboard.press('Escape');
	}
	// Move off the toolbar so it tucks away again before the shot.
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 3);
	await page.waitForTimeout(1500);
}

async function sendValues(values) {
	// The page's own socket is private, so this opens a second one, as the Rhino panel would.
	await page.evaluate(
		async ({ wsPort, secret, session, values }) => {
			const ws = new WebSocket(`ws://localhost:${wsPort}`);
			await new Promise((resolve, reject) => {
				ws.onopen = resolve;
				ws.onerror = reject;
			});
			ws.send(JSON.stringify({ type: 'authenticate', secret }));
			// Keys may be input ids or nicknames; the schema maps one to the other.
			const schema = await new Promise((resolve) => {
				ws.onmessage = (m) => {
					if (typeof m.data !== 'string') return;
					const msg = JSON.parse(m.data);
					if (msg.type === 'initialData') resolve(msg.schema);
				};
				ws.send(
					JSON.stringify({ type: 'requestInitialData', sessionId: session, schemaOnly: true })
				);
			});
			const ids = Object.fromEntries((schema?.inputs ?? []).map((i) => [i.nickname, i.id]));
			const byId = Object.fromEntries(Object.entries(values).map(([k, v]) => [ids[k] ?? k, v]));
			ws.send(JSON.stringify({ type: 'valueUpdate', sessionId: session, values: byId }));
			// Left open: the bridge cancels a solve whose socket closes.
			window.__snapSockets = [...(window.__snapSockets ?? []), ws];
		},
		{
			wsPort: bridge.searchParams.get('wsPort') ?? '8765',
			secret: new URLSearchParams(bridge.hash.slice(1)).get('s'),
			session,
			values
		}
	);
	await page.waitForTimeout(300);
}

const written = [];
await page.goto(preview.toString());
await page.getByText('Loading preview...').waitFor({ state: 'hidden', timeout: 30_000 });
await settle();

for (const set of sets) {
	if (set.values) {
		await sendValues(set.values);
		await settle();
	}
	// One shot per form tab: charts and downloads usually sit on a later one.
	const tabs = page.getByRole('tab');
	const tabCount = Math.max(1, await tabs.count());
	for (let i = 0; i < tabCount; i++) {
		const label = (await tabs.count()) ? await tabs.nth(i).innerText() : 'page';
		if (await tabs.count()) await tabs.nth(i).click();
		await page.waitForTimeout(600);
		const shot = path.join(
			opts.out,
			`${set.name}-tab-${label.trim().replace(/\W+/g, '-').toLowerCase()}.png`
		);
		await page.screenshot({ path: shot, fullPage: true });
		written.push(shot);
	}
	if (tabCount > 1) await tabs.first().click();
	for (const look of looks) {
		await setLook(look);
		const viewShot = path.join(opts.out, `${set.name}-${look}.png`);
		// Clipped page shot, not an element shot: Playwright waits for an element to be stable,
		// and the canvas never is while emissive lights keep the viewer rendering.
		const box = await page.getByTestId('viewer-canvas').boundingBox();
		// Night with several lamps renders slowly under SwiftShader.
		await page.screenshot({ path: viewShot, clip: box ?? undefined, timeout: 180_000 });
		written.push(viewShot);
	}
}

await browser.close();
writeFileSync(path.join(opts.out, 'console-errors.txt'), log.join('\n'));
console.log(written.join('\n'));
if (log.length)
	console.log(`${log.length} console error(s): ${path.join(opts.out, 'console-errors.txt')}`);
