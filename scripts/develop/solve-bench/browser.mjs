#!/usr/bin/env node

// Times what the server rows can't see: from changing an input in the real page until the viewer
// draws the result. Download, JSON parse, mesh decode and the first frame all land here.
//
//   node scripts/develop/solve-bench/browser.mjs [--profile bench] [--input Colour] [--steps 5]
//                                                [--user admin] [--headed] [--gpu auto|software]
//
// Needs `run.mjs setup` first: it signs the users in and uploads the definition.

import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { DEFAULT_OUT, ROOT, median, pickValue, round, table, userBase, mb } from './lib.mjs';
import { PROFILES } from './profiles.mjs';

// ============================================================================
// Args
// ============================================================================

const { values: opts } = parseArgs({
	options: {
		profile: { type: 'string', default: 'bench' },
		input: { type: 'string' },
		steps: { type: 'string', default: '5' },
		user: { type: 'string', default: 'admin' },
		headed: { type: 'boolean', default: false },
		gpu: { type: 'string', default: 'auto' },
		channel: { type: 'string', default: 'chrome' },
		out: { type: 'string', default: DEFAULT_OUT },
		label: { type: 'string', default: '' },
		'timeout-s': { type: 'string', default: '180' }
	}
});

const profile = PROFILES[opts.profile] ?? JSON.parse(readFileSync(opts.profile, 'utf8'));
const profileName = PROFILES[opts.profile] ? opts.profile : path.basename(opts.profile, '.json');
const state = JSON.parse(readFileSync(path.join(opts.out, 'state.json'), 'utf8'));
const def = state.definitions?.[profileName];
const user = state.users?.[opts.user];
if (!def?.guid || !user) {
	console.error(
		`No ${profileName} definition or user ${opts.user} in ${opts.out}: run run.mjs setup first.`
	);
	process.exit(1);
}
const inputName = opts.input ?? profile.vary;
const timeoutMs = Number(opts['timeout-s']) * 1000;

// Same flags as the viewer lab: headless Chrome on the real GPU through ANGLE.
const GPU_FLAGS = {
	auto: ['--use-angle=d3d11', '--ignore-gpu-blocklist'],
	software: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
};

// Playwright is a dependency of the app package, not of the repo root.
const require = createRequire(path.join(ROOT, 'packages', 'selva', 'package.json'));
const pw = await import(pathToFileURL(require.resolve('@playwright/test')).href);
const chromium = pw.chromium ?? pw.default.chromium;

// ============================================================================
// In-page probes
// ============================================================================

// Runs before the app. Nothing in the app marks "this solve's scene is on screen", so the probes
// collect what can be observed from outside: the solve request's timeline, the solve-status
// pill's state, the canvas's mesh count, and per frame the first draw call and the bytes uploaded
// to GPU buffers (a new scene uploads its geometry on its first frame).
function probes() {
	const solves = [];
	const marks = [];
	const frames = [];
	let frame = null;
	let pendingUpload = 0;

	const origFetch = window.fetch;
	window.fetch = async function (input, init) {
		const url = typeof input === 'string' ? input : input.url;
		const method = String(
			init?.method ?? (typeof input === 'string' ? 'GET' : input.method)
		).toUpperCase();
		if (
			method !== 'POST' ||
			!/\/api\/v1\/compute(\?|$)/.test(new URL(url, location.href).pathname + '?')
		)
			return origFetch.apply(this, arguments);
		const rec = { tReq: performance.now() };
		solves.push(rec);
		const res = await origFetch.apply(this, arguments);
		rec.tHeaders = performance.now();
		rec.status = res.status;
		rec.serverTiming = res.headers.get('server-timing');
		const text = res.text.bind(res);
		res.text = async () => {
			const t = await text();
			rec.tBody = performance.now();
			rec.bytes = t.length;
			return t;
		};
		return res;
	};

	const onDraw = () => {
		if (frame) return;
		frame = { t: performance.now(), upload: pendingUpload };
		pendingUpload = 0;
		frames.push(frame);
		requestAnimationFrame(() => (frame = null));
	};
	const onUpload = (size) => {
		if (frame) frame.upload += size;
		else pendingUpload += size;
	};
	for (const Ctx of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
		if (!Ctx) continue;
		for (const m of [
			'drawElements',
			'drawArrays',
			'drawElementsInstanced',
			'drawArraysInstanced',
			'drawRangeElements'
		]) {
			const f = Ctx.prototype[m];
			if (f)
				Ctx.prototype[m] = function () {
					onDraw();
					return f.apply(this, arguments);
				};
		}
		const bufferData = Ctx.prototype.bufferData;
		Ctx.prototype.bufferData = function (target, data) {
			onUpload(typeof data === 'number' ? data : (data?.byteLength ?? 0));
			return bufferData.apply(this, arguments);
		};
	}

	new MutationObserver((list) => {
		for (const m of list) {
			const el = m.target;
			if (el.dataset?.testid === 'solve-status')
				marks.push({ t: performance.now(), state: el.dataset.state });
			if (el.dataset?.testid === 'viewer-canvas')
				marks.push({ t: performance.now(), meshes: el.dataset.meshCount });
		}
	}).observe(document, {
		subtree: true,
		attributes: true,
		attributeFilter: ['data-state', 'data-mesh-count']
	});

	// The first evidence after the body that the new result is in the scene, then the frame that drew it.
	window.__solveBench = {
		now: () => performance.now(),
		result(after) {
			const s = solves.find((x) => x.tReq > after && x.tBody);
			if (!s) return null;
			const evidence = [];
			const status = marks.find(
				(m) => m.t > s.tBody && m.state && m.state !== 'work' && m.state !== 'card'
			);
			if (status) evidence.push({ t: status.t, kind: 'solve-status' });
			const count = marks.find((m) => m.t > s.tBody && m.meshes !== undefined);
			if (count) evidence.push({ t: count.t, kind: 'mesh-count' });
			const upload = frames.find((f) => f.t > s.tBody && f.upload > 0);
			if (upload) evidence.push({ t: upload.t, kind: 'gpu-upload' });
			evidence.sort((a, b) => a.t - b.t);
			// A result that changes nothing on screen (an empty or identical scene) leaves no
			// evidence; after a grace period it counts as applied when its body arrived.
			if (!evidence.length && performance.now() - s.tBody > 3000)
				evidence.push({ t: s.tBody, kind: 'none' });
			const applied = evidence[0];
			if (!applied) return null;
			const drawn =
				applied.kind === 'gpu-upload'
					? upload
					: (frames.find((f) => f.t >= applied.t) ??
						(applied.kind === 'none' ? { t: applied.t, upload: 0 } : null));
			if (!drawn) return null;
			return {
				...s,
				tApplied: applied.t,
				evidence: applied.kind,
				tDrawn: drawn.t,
				upload: drawn.upload
			};
		},
		debug: () => ({ solves, marks: marks.slice(-10), frames: frames.length })
	};
}

// ============================================================================
// Driving the form
// ============================================================================

async function reveal(page, locator) {
	if (await locator.isVisible()) return;
	for (const tab of await page.getByRole('tab').all()) {
		await tab.click();
		if (await locator.isVisible()) return;
	}
	throw new Error(
		`input not found on any tab: ${await locator.evaluate((e) => e.id).catch(() => '?')}`
	);
}

async function setInput(page, input, value) {
	const field = page.locator(`#input-${input.id}`);
	await reveal(page, field);
	const type = String(input.paramType).toLowerCase();
	if (type === 'boolean') {
		if ((await field.isChecked()) !== value) await field.click();
	} else if (type === 'color' || type === 'colour') {
		await field.click();
		const hex = page
			.locator(
				'[data-slot="popover-content"] input[type="text"], [role="dialog"] input[type="text"]'
			)
			.first();
		await hex.fill(value);
		await hex.press('Enter');
		await page.keyboard.press('Escape');
	} else if (['number', 'integer'].includes(type)) {
		await field.fill(String(value));
		await field.press('Enter');
	} else {
		throw new Error(
			`browser.mjs can't set a ${input.paramType} input yet: pick a number, boolean or colour input`
		);
	}
	// A definition that solves on demand shows a Calculate button instead of solving.
	const calculate = page.getByRole('button', { name: /^calculate$/i });
	if (await calculate.isVisible().catch(() => false)) await calculate.click();
}

async function waitForResult(page, after) {
	try {
		const handle = await page.waitForFunction((t) => window.__solveBench.result(t), after, {
			timeout: timeoutMs,
			polling: 50
		});
		return await handle.jsonValue();
	} catch (err) {
		const seen = await page.evaluate(() => window.__solveBench.debug()).catch(() => null);
		throw new Error(
			`no solve result within ${timeoutMs / 1000} s; probes saw ${JSON.stringify(seen)}`,
			{ cause: err }
		);
	}
}

// ============================================================================
// Main
// ============================================================================

const base = state.base;
let browser;
try {
	browser = await chromium.launch({
		channel: opts.channel,
		headless: !opts.headed,
		args: [...(opts.headed ? [] : ['--headless=new']), ...(GPU_FLAGS[opts.gpu] ?? GPU_FLAGS.auto)]
	});
} catch (err) {
	console.warn(
		`channel ${opts.channel} unavailable, using Playwright's Chromium: ${err.message.split('\n')[0]}`
	);
	browser = await chromium.launch({
		headless: !opts.headed,
		args: GPU_FLAGS[opts.gpu] ?? GPU_FLAGS.auto
	});
}
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
await context.addCookies(
	Object.entries(user.cookies).map(([name, value]) => ({ name, value, url: base }))
);
await context.addInitScript(probes);
const page = await context.newPage();

const schema = await (
	await context.request.get(`${base}/api/v1/definitions/${def.guid}/schema`)
).json();
const input = schema.inputs.find((i) => i.nickname === inputName);
const spec = profile.inputs[inputName];
if (!input || !spec)
	throw new Error(
		`"${inputName}" is not an input of the definition or has no range in the profile`
	);

console.log(
	`opening ${base}/library/${def.guid} as ${opts.user}, changing "${inputName}" ${opts.steps}×`
);
await page.goto(`${base}/library/${def.guid}`);
const start = page.getByRole('button', { name: /press to calculate|^calculate$/i });
// performance.now() restarts with the document, so any solve on this page counts.
const first = waitForResult(page, 0);
await Promise.race([
	first,
	start
		.waitFor({ timeout: 15_000 })
		.then(() => start.click())
		.catch(() => {})
]);
await first;
// Idle refine draws for a moment after a scene lands; a step started inside it would race it.
await page.waitForTimeout(1500);

mkdirSync(path.join(opts.out, 'runs'), { recursive: true });
const runFile = path.join(
	opts.out,
	'runs',
	`${new Date().toISOString().replace(/[:.]/g, '-')}-browser-${profileName}${opts.label ? `-${opts.label}` : ''}.jsonl`
);
let current = userBase(profile, 0)[inputName];
const rows = [];
for (let i = 0; i < Number(opts.steps); i++) {
	current = pickValue(spec, current);
	const tChange = await page.evaluate(() => window.__solveBench.now());
	await setInput(page, input, current);
	const r = await waitForResult(page, tChange);
	const row = {
		step: i + 1,
		value: current,
		evidence: r.evidence,
		'to request': round(r.tReq - tChange),
		server: round(r.tHeaders - r.tReq),
		download: round(r.tBody - r.tHeaders),
		'parse+apply': round(r.tApplied - r.tBody),
		draw: round(r.tDrawn - r.tApplied),
		total: round(r.tDrawn - tChange),
		MB: mb(r.bytes),
		status: r.status
	};
	rows.push(row);
	appendFileSync(
		runFile,
		JSON.stringify({
			...row,
			input: inputName,
			profile: profileName,
			serverTiming: r.serverTiming,
			uploadBytes: r.upload
		}) + '\n'
	);
	await page.waitForTimeout(1500);
}
await browser.close();

const cols = [
	'step',
	'value',
	'to request',
	'server',
	'download',
	'parse+apply',
	'draw',
	'total',
	'MB',
	'evidence'
];
const med = Object.fromEntries(
	cols.map((c) => [c, typeof rows[0]?.[c] === 'number' ? round(median(rows.map((r) => r[c]))) : ''])
);
med.step = 'median';
console.log(table([...rows, med], cols));
console.log(`\nrows: ${runFile}`);
