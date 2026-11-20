import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

/** A camera direction, as Selva's viewer names them. */
export type CaptureView = 'iso' | 'top' | 'front' | 'back' | 'left' | 'right' | 'bottom';

export interface CaptureCamera {
	view?: CaptureView;
	/** Degrees around the up axis: 0 looks from the front, 90 from the right, 180 from the back. Overrides `view`. */
	azimuth?: number;
	/** Degrees above the horizon, -89 to 89. Default 30 when `azimuth` is set. */
	elevation?: number;
	/** 1 fits the geometry; 2 is twice as close. Default 1. */
	zoom?: number;
	/** World point to look at, in model units. Default the middle of what is drawn. */
	target?: [number, number, number];
	/** Names the picture; defaults to the view or the angles. */
	label?: string;
}

export interface CaptureOptions {
	/** One camera. Ignored when `cameras` is given. */
	view?: CaptureView;
	/** One picture per camera, drawn from the same scene. */
	cameras?: CaptureCamera[];
	/** Layers or object names to leave out. A layer hides its sublayers: `Room` hides `Room/Walls`. */
	hide?: string[];
	/** Per camera, leave out tall thin walls standing between the camera and the middle of the scene. */
	cutaway?: boolean;
	/** Default true: fit the camera tightly to what is drawn. False keeps the viewer's looser framing. */
	frame?: boolean;
	/** One picture with every camera in a labelled grid, instead of one per camera. */
	sheet?: boolean;
	/** Pixels. Default 1200 × 800. */
	width?: number;
	height?: number;
	/** Default true. */
	grid?: boolean;
	/** One of the viewer's looks; an unknown one draws as `technical`. */
	look?: string;
	/** Hex, e.g. `#e6e6e6`. */
	background?: string;
	/**
	 * The HDR environment the viewer lights with, as a URL (`data:` works: the page loads no
	 * origin). Without it the viewer generates its lighting, which reads flatter.
	 */
	hdr?: () => Promise<string | undefined>;
	/**
	 * The capture page. Defaults to `dist/views/capture.html` beside this module, which a bundler
	 * that moves this module breaks: a bundled host passes the file's text instead.
	 */
	html?: () => Promise<string>;
	/**
	 * A Chromium or Chrome to launch. Unset: Playwright's own, else an installed Chrome, Edge or
	 * distro Chromium.
	 */
	executablePath?: string;
	/** Default 60 s, launch included. */
	timeoutMs?: number;
	/**
	 * Cancels the capture: a queued one never starts and a running one closes its page, so the
	 * next in the queue need not wait for it.
	 */
	signal?: AbortSignal;
}

export interface CaptureImage {
	/** Base64 PNG. */
	png: string;
	label: string;
	/** Layers or names the cutaway left out of this picture. */
	cut: string[];
}

export interface Capture {
	/** The first picture, or the sheet. Empty when nothing was drawn. */
	png: string;
	/** One per camera, or the one sheet. */
	images: CaptureImage[];
	/** Objects drawn. Zero means the response had no display geometry and there are no pictures. */
	drawn: number;
	/** Every layer drawn, the names `hide` takes. */
	layers: string[];
}

/** Thrown when no browser can be launched; its message says how to install one. */
export class CaptureUnavailableError extends Error {
	override name = 'CaptureUnavailableError';
}

interface Page {
	setViewportSize(size: { width: number; height: number }): Promise<void>;
	setContent(html: string, options?: { waitUntil?: 'load' }): Promise<void>;
	evaluate<R, A>(fn: (arg: A) => R | Promise<R>, arg: A): Promise<R>;
	setDefaultTimeout(ms: number): void;
	close(): Promise<void>;
}
interface Browser {
	newPage(options?: { deviceScaleFactor?: number }): Promise<Page>;
	close(): Promise<void>;
	on(event: 'disconnected', listener: () => void): void;
}
interface Chromium {
	launch(options: {
		executablePath?: string;
		channel?: string;
		args?: string[];
		timeout?: number;
	}): Promise<Browser>;
}

// Distro Chromium, which Playwright's `chrome` channel does not look for.
const FALLBACK_PATHS = [
	'/usr/bin/chromium',
	'/usr/bin/chromium-browser',
	'/snap/bin/chromium',
	'/usr/bin/google-chrome'
];

const CAPTURE_FILE = new URL('../dist/views/capture.html', import.meta.url);
// Software WebGL: a server has no GPU, and headless Chromium refuses WebGL without these.
const ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
// One browser serves every capture and closes after this long without one.
const IDLE_CLOSE_MS = 120_000;

let browser: Promise<Browser> | undefined;
let idle: ReturnType<typeof setTimeout> | undefined;
// One capture at a time: each holds a WebGL context and the whole response in the page.
let queue: Promise<unknown> = Promise.resolve();

async function launch(executablePath: string | undefined, timeout: number): Promise<Browser> {
	// A variable specifier, so a bundler leaves the optional dependency to be found at run time.
	const name = 'playwright-core';
	let chromium: Chromium;
	try {
		({ chromium } = (await import(/* @vite-ignore */ name)) as { chromium: Chromium });
	} catch {
		throw new CaptureUnavailableError(
			'Rendering needs the `playwright-core` package on the server, which is not installed.'
		);
	}
	// Without an explicit path, fall back to a browser the machine already has: installing
	// Playwright's needs `--with-deps`, which needs root, which most hosts never grant.
	const candidates: { executablePath?: string; channel?: string }[] = executablePath
		? [{ executablePath }]
		: [
				{},
				{ channel: 'chrome' },
				{ channel: 'msedge' },
				...FALLBACK_PATHS.filter((p) => existsSync(p)).map((p) => ({ executablePath: p }))
			];
	let first: unknown;
	for (const candidate of candidates) {
		try {
			const launched = await chromium.launch({ ...candidate, args: ARGS, timeout });
			launched.on('disconnected', () => (browser = undefined));
			return launched;
		} catch (err) {
			first ??= err;
		}
	}
	throw new CaptureUnavailableError(
		`No browser to render with: ${first instanceof Error ? first.message.split('\n')[0] : String(first)}. ` +
			'Install Chrome or Chromium on the server (`npx playwright install --with-deps chromium`, ' +
			'or the system package), or point the server at one.'
	);
}

/**
 * Draws a Rhino.Compute response in Selva's viewer, in a headless Chromium, and returns a PNG.
 * Needs `playwright-core` and a Chromium on the machine; throws {@link CaptureUnavailableError}
 * without them.
 */
export function captureSolve(response: unknown, options: CaptureOptions = {}): Promise<Capture> {
	const { signal } = options;
	const run = queue.then(() => {
		signal?.throwIfAborted();
		return capture(response, options);
	});
	queue = run.catch(() => {});
	if (!signal) return run;
	return new Promise<Capture>((resolve, reject) => {
		const onAbort = () => reject(signal.reason);
		if (signal.aborted) return onAbort();
		signal.addEventListener('abort', onAbort, { once: true });
		run.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
	});
}

async function capture(response: unknown, options: CaptureOptions): Promise<Capture> {
	const timeout = options.timeoutMs ?? 60_000;
	clearTimeout(idle);
	browser ??= launch(options.executablePath, timeout).catch((err: unknown) => {
		browser = undefined;
		throw err;
	});
	const html = await (options.html ?? (() => readFile(CAPTURE_FILE, 'utf8')))();
	const page = await (await browser).newPage({ deviceScaleFactor: 1 });
	// Closing the page makes whatever it is doing reject at once.
	const closePage = () => void page.close().catch(() => {});
	options.signal?.addEventListener('abort', closePage, { once: true });
	try {
		options.signal?.throwIfAborted();
		page.setDefaultTimeout(timeout);
		await page.setViewportSize({ width: options.width ?? 1200, height: options.height ?? 800 });
		await page.setContent(html, { waitUntil: 'load' });
		const hdr = options.hdr ? await options.hdr() : undefined;
		const result = await page.evaluate(
			(req) =>
				(
					globalThis as unknown as {
						selvaCapture(r: typeof req): Promise<Omit<Capture, 'png'>>;
					}
				).selvaCapture(req),
			{
				response,
				cameras: options.cameras?.length ? options.cameras : [{ view: options.view ?? 'iso' }],
				grid: options.grid ?? true,
				look: options.look,
				background: options.background,
				hdr,
				hide: options.hide,
				cutaway: options.cutaway,
				frame: options.frame,
				sheet: options.sheet
			}
		);
		return { ...result, png: result.images[0]?.png ?? '' };
	} finally {
		options.signal?.removeEventListener('abort', closePage);
		await page.close().catch(() => {});
		idle = setTimeout(() => {
			const open = browser;
			browser = undefined;
			void open?.then((b) => b.close()).catch(() => {});
		}, IDLE_CLOSE_MS);
		idle.unref?.();
	}
}
