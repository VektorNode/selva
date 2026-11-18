// Shared by the marketing capture scripts: one browser setup, stills at 2x, and video recorded
// as full-quality frames that ffmpeg assembles, because Playwright's own .webm is too soft to cut.

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const outRoot = path.join(root, 'marketing');

// plugin-ui owns the Playwright install, along with its browsers.
const { chromium } = createRequire(path.join(root, 'packages/plugin-ui/package.json'))(
	'@playwright/test'
);

export const DESKTOP = { width: 1600, height: 1000 };
export const VIDEO = { width: 1920, height: 1080 };
export const PHONE = { width: 390, height: 844 };

export function flag(name, fallback) {
	const at = process.argv.indexOf(`--${name}`);
	return at === -1 ? fallback : process.argv[at + 1];
}

/**
 * Installed Chrome, headless, on the real GPU: SwiftShader draws the viewer's shadows and
 * reflections too slowly to record and with visible banding.
 */
export async function launch() {
	return chromium.launch({
		channel: 'chrome',
		headless: true,
		args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--hide-scrollbars']
	});
}

/** @param {{ viewport?: {width:number,height:number}, dark?: boolean, scale?: number, storageState?: string }} opts */
export async function openPage(browser, opts = {}) {
	const context = await browser.newContext({
		viewport: opts.viewport ?? DESKTOP,
		deviceScaleFactor: opts.scale ?? 2,
		colorScheme: opts.dark ? 'dark' : 'light',
		storageState: opts.storageState,
		reducedMotion: 'no-preference'
	});
	if (opts.cursor) await context.addInitScript(drawCursor);
	const page = await context.newPage();
	page.setDefaultTimeout(60_000);
	return page;
}

/**
 * Headless Chrome paints no pointer, so a recording needs one drawn into the page: the system
 * arrow, following the real mouse events, dipping on a press.
 */
function drawCursor() {
	const attach = () => {
		if (document.getElementById('__cursor')) return;
		const el = document.createElement('div');
		el.id = '__cursor';
		el.style.cssText =
			'position:fixed;left:0;top:0;width:22px;height:32px;z-index:2147483647;pointer-events:none;' +
			'transform:translate(-100px,-100px);will-change:transform;' +
			'filter:drop-shadow(0 1px 1.5px rgba(0,0,0,.35));';
		el.innerHTML =
			'<svg viewBox="0 0 22 32" width="22" height="32" style="display:block;transform-origin:2px 2px;transition:transform 70ms ease-out">' +
			'<path d="M2 2v23.2l5.6-5.3 3.9 9.1 3.5-1.5-3.9-9h7.7z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
		document.documentElement.appendChild(el);
		const arrow = el.firstElementChild;
		addEventListener(
			'mousemove',
			(e) => (el.style.transform = `translate(${e.clientX - 2}px,${e.clientY - 2}px)`),
			true
		);
		addEventListener('mousedown', () => (arrow.style.transform = 'scale(.86)'), true);
		addEventListener('mouseup', () => (arrow.style.transform = ''), true);
	};
	if (document.documentElement) attach();
	else document.addEventListener('DOMContentLoaded', attach);
	// A framework that replaces the document's children takes the cursor with them.
	new MutationObserver(attach).observe(document, { childList: true, subtree: false });
}

export function outPath(...parts) {
	const file = path.join(outRoot, ...parts);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	return file;
}

/**
 * `tall` grows the window to the page's height for the shot. Playwright's `fullPage` stitches
 * instead, which leaves anything pinned to the window's bottom edge across the middle.
 */
export async function still(page, name, { tall, ...options } = {}) {
	const file = outPath(`${name}.png`);
	const size = page.viewportSize();
	const height = tall ? await page.evaluate(() => document.documentElement.scrollHeight) : 0;
	if (height > size.height) {
		await page.setViewportSize({ width: size.width, height });
		await page.waitForTimeout(400);
	}
	await page.screenshot({ path: file, ...options });
	if (height > size.height) await page.setViewportSize(size);
	console.info(path.relative(root, file));
	return file;
}

/**
 * Records `run` as an .mp4. Frames arrive only when the page repaints, so each is held for the
 * gap to the next one; a constant-rate encode of the raw frames would play still moments fast.
 */
export async function record(page, name, run, { fps = 30 } = {}) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'selva-rec-'));
	const frames = [];
	const size = page.viewportSize();
	await page.screencast.start({
		size,
		quality: 100,
		fps,
		onFrame: ({ data, timestamp }) => {
			const file = path.join(dir, `${String(frames.length).padStart(6, '0')}.jpg`);
			fs.writeFileSync(file, data);
			frames.push({ file, timestamp });
		}
	});
	try {
		await run();
		// Hold the last state long enough to read it.
		await page.waitForTimeout(1200);
	} catch (error) {
		await page.screenshot({ path: outPath(`${name}-failed.png`) }).catch(() => {});
		throw error;
	} finally {
		await page.screencast.stop();
	}
	if (frames.length < 2) throw new Error(`${name}: the screencast delivered no frames`);

	const span = frames.at(-1).timestamp - frames[0].timestamp;
	// The timestamp unit is not documented; a recording runs seconds, not milliseconds.
	const perSecond = span > 5000 ? 1000 : 1;
	const list = frames
		.map((frame, i) => {
			const next = frames[i + 1];
			const hold = next ? (next.timestamp - frame.timestamp) / perSecond : 1 / fps;
			return `file '${frame.file.replaceAll('\\', '/')}'\nduration ${Math.max(hold, 0.001).toFixed(4)}`;
		})
		.join('\n');
	const listFile = path.join(dir, 'frames.txt');
	fs.writeFileSync(listFile, `${list}\nfile '${frames.at(-1).file.replaceAll('\\', '/')}'\n`);

	const file = outPath(`${name}.mp4`);
	const encode = spawnSync(
		'ffmpeg',
		[
			'-y',
			'-loglevel',
			'error',
			'-f',
			'concat',
			'-safe',
			'0',
			'-i',
			listFile,
			'-vf',
			`fps=${fps},scale=trunc(iw/2)*2:trunc(ih/2)*2:flags=lanczos,format=yuv420p`,
			'-c:v',
			'libx264',
			'-crf',
			'16',
			'-preset',
			'slow',
			'-movflags',
			'+faststart',
			file
		],
		{ stdio: 'inherit' }
	);
	fs.rmSync(dir, { recursive: true, force: true });
	if (encode.status !== 0) throw new Error(`${name}: ffmpeg failed`);
	console.info(path.relative(root, file));
	return file;
}

// ============================================================================
// Pointer
// ============================================================================
//
// A straight, constant-speed move to an element's exact centre reads as a script. A hand starts
// fast and brakes into the target, travels a shallow arc, lands a little off centre, and rests
// before it presses.

// Seeded, so a rerun moves the same way and two takes can be cut together.
let seed = 0x5e1fa;
function random() {
	seed = (seed * 1664525 + 1013904223) >>> 0;
	return seed / 0x100000000;
}
const between = (low, high) => low + random() * (high - low);

const positions = new WeakMap();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Minimum-jerk profile, skewed so the braking half is the longer one. */
function ease(t) {
	const u = Math.pow(t, 0.8);
	return u * u * u * (10 - 15 * u + 6 * u * u);
}

/** @param {{ duration?: number, arc?: number }} [opts] `arc` scales the sideways bow; 0 is straight. */
export async function glide(page, x, y, opts = {}) {
	const from = positions.get(page) ?? {
		x: page.viewportSize().width * 0.55,
		y: page.viewportSize().height * 0.6
	};
	const dx = x - from.x;
	const dy = y - from.y;
	const distance = Math.hypot(dx, dy);
	if (distance < 1) return;
	const duration = opts.duration ?? Math.min(1100, 260 + distance * 0.95) * between(0.88, 1.15);
	const bow = distance * between(0.04, 0.13) * (opts.arc ?? 1) * (random() < 0.5 ? -1 : 1);
	const control = {
		x: from.x + dx / 2 - (dy / distance) * bow,
		y: from.y + dy / 2 + (dx / distance) * bow
	};

	const started = performance.now();
	for (;;) {
		const t = Math.min(1, (performance.now() - started) / duration);
		const s = ease(t);
		const a = (1 - s) * (1 - s);
		const b = 2 * (1 - s) * s;
		const c = s * s;
		await page.mouse.move(a * from.x + b * control.x + c * x, a * from.y + b * control.y + c * y);
		if (t >= 1) break;
		await sleep(8);
	}
	positions.set(page, { x, y });
}

/** A point inside the element, off its centre, where a hand would land. */
async function landing(locator) {
	const box = await locator.boundingBox();
	if (!box) throw new Error('The element is not on screen');
	return {
		x: box.x + box.width * between(0.38, 0.62),
		y: box.y + box.height * between(0.4, 0.65)
	};
}

export async function glideTo(page, locator, opts) {
	const point = await landing(locator);
	await glide(page, point.x, point.y, opts);
}

export async function press(page) {
	await sleep(between(110, 240));
	await page.mouse.down();
	await sleep(between(55, 110));
	await page.mouse.up();
	await sleep(between(180, 340));
}

export async function click(page, locator) {
	await glideTo(page, locator);
	await press(page);
}

/** Press at the pointer, travel to (x, y), release. The pointer must already be on the handle. */
export async function dragTo(page, x, y, opts = {}) {
	await sleep(between(120, 220));
	await page.mouse.down();
	await sleep(between(90, 160));
	await glide(page, x, y, { arc: 0.25, ...opts });
	await sleep(between(140, 260));
	await page.mouse.up();
	await sleep(between(200, 350));
}

export const pause = (page, low, high = low) => page.waitForTimeout(between(low, high));
