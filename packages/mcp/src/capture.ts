import { readFile } from 'node:fs/promises';

/** A camera direction, as Selva's viewer names them; `default` is `camera`, or iso without one. */
export type CaptureView =
	'default' | 'iso' | 'top' | 'front' | 'back' | 'left' | 'right' | 'bottom';

export interface CaptureOptions {
	/** One view; ignored when `views` is given. Default `default`. */
	view?: CaptureView;
	/** Several views of the one scene, a PNG each, in order. Costs a render each, not a solve. */
	views?: CaptureView[];
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
	 * What the `default` view shows: a saved view, as `CameraView` in `@selvajs/visualization/render`.
	 * Only its direction counts: the capture frames the model to fit its own canvas.
	 */
	camera?: { direction: number[]; position?: number[]; target?: number[] };
	/**
	 * The HDR environment the viewer lights with, as a URL (`data:` works: the page loads no
	 * origin). Without it the viewer generates its lighting, which reads flatter.
	 */
	hdr?: () => Promise<string>;
	/**
	 * The capture page. Defaults to `dist/views/capture.html` beside this module, which a bundler
	 * that moves this module breaks: a bundled host passes the file's text instead.
	 */
	html?: () => Promise<string>;
	/** A Chromium or Chrome to launch instead of the one `playwright install chromium` puts in place. */
	executablePath?: string;
	/** Default 60 s, launch included. */
	timeoutMs?: number;
	/**
	 * Cancels the capture: a queued one never starts and a running one closes its page, so the
	 * next in the queue need not wait for it.
	 */
	signal?: AbortSignal;
}

export interface Capture {
	/** Base64 PNG of the first view. */
	png: string;
	/** Base64 PNG per view, in the order asked. */
	pngs: string[];
	/** Objects drawn. Zero means the response had no display geometry and `png` is empty. */
	drawn: number;
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
	launch(options: { executablePath?: string; args?: string[]; timeout?: number }): Promise<Browser>;
}

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
	try {
		const launched = await chromium.launch({ executablePath, args: ARGS, timeout });
		launched.on('disconnected', () => (browser = undefined));
		return launched;
	} catch (err) {
		throw new CaptureUnavailableError(
			`No browser to render with: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}. ` +
				'Install one on the server with `npx playwright install --with-deps chromium`, or point ' +
				'the server at an existing Chromium.'
		);
	}
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
		const { pngs, drawn } = await page.evaluate(
			(req) =>
				(
					globalThis as unknown as {
						selvaCapture(r: typeof req): Promise<{ pngs: string[]; drawn: number }>;
					}
				).selvaCapture(req),
			{
				response,
				views: options.views?.length ? options.views : [options.view ?? 'default'],
				grid: options.grid ?? true,
				look: options.look,
				background: options.background,
				camera: options.camera,
				hdr
			}
		);
		return { png: pngs[0] ?? '', pngs, drawn };
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
