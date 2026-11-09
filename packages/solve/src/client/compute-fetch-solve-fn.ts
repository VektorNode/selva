/**
 * A ready-made `SolveFn` that POSTs to a `/api/compute`-shaped endpoint (the wire contract
 * `SolveEngine` produces) and unpacks the result, with 429 cooldown, session-expiry detection,
 * a bad-response guard, and abort handling at every await.
 *
 * Mesh decoding is NOT built in: this package stays renderer-agnostic, so a viewer-enabled
 * consumer supplies `meshes.extract` (typically `getThreeObjectsFromComputeResponse` from
 * `@selvajs/visualization/parse`).
 */

import {
	GrasshopperResponseProcessor,
	type GrasshopperComputeResponse
} from '@selvajs/compute/grasshopper';
import type { SolveFn, SolveResult } from '../shared/solve-fn.js';
import { decodeOutcome, finalizeResult, outcomeFromComputeMessages } from '../shared/outcome.js';

export interface ComputeFetchSolveFnOptions<TMesh = unknown> {
	/** The compute endpoint to POST to, e.g. `/api/compute`. */
	endpoint: string;
	/** Definition URL (or `local:<guid>`) to solve — read per-solve so it can track a route param. */
	definitionUrl: () => string;
	/** Schema input params, sent as the request body's `inputs`. A stored definition's server ignores them. */
	inputs: () => Array<{ id: string }>;
	/** Schema output params — drives byId/byName output extraction after a solve. */
	outputs: () => Array<{ id: string; nickname?: string }>;
	channel?: () => 'live' | 'draft' | undefined;
	versionId?: () => string | null | undefined;
	/** The tab's live-event stream id (`createSolveEventStream().streamId`), so the server routes this solve's events to it. */
	streamId?: () => string | null | undefined;
	/** Sent as `Authorization: Bearer …`, e.g. a share-link token. A header, not the URL, so it stays out of access logs. */
	bearerToken?: () => string | null | undefined;
	/** Omit entirely for a non-viewer consumer — `meshes` on the result stays `[]`. */
	meshes?: {
		extract: (
			response: GrasshopperComputeResponse,
			opts: { debug: boolean; signal: AbortSignal }
		) => TMesh[] | Promise<TMesh[]>;
	};
	/** Gates ALL console telemetry (timing, cache verdicts, whales, heap). Default `false`. */
	debug?: boolean;
	/** Called on a 429 and on a solve refused during its cooldown, before the rate-limit Error. */
	onRateLimited?: (retryAfterSeconds: number) => void;
	/** Called on a 401 or a login-page redirect, before the "sign in again" Error. */
	onSessionExpired?: () => void;
	/** Where the server redirects an expired session. Default `/login`. */
	loginPath?: string;
}

/** Applied to a 429 that names no wait. */
const DEFAULT_RETRY_AFTER_S = 5;
/** A server's hint, not a lock: past this the client tries again anyway. */
const MAX_RETRY_AFTER_S = 3600;

function parseServerTiming(header: string | null): Record<string, number> {
	const out: Record<string, number> = {};
	if (!header) return out;
	for (const part of header.split(',')) {
		const [name, ...params] = part.split(';').map((s) => s.trim());
		const dur = params.find((p) => p.startsWith('dur='));
		if (!name || !dur) continue;
		const ms = Number(dur.slice(4));
		if (Number.isFinite(ms)) out[name] = ms;
	}
	return out;
}

function rateLimitedError(retryAfterSeconds: number): Error {
	return new Error(`Rate limit reached. Try again in ${Math.ceil(retryAfterSeconds)}s.`);
}

function sessionExpiredError(): Error {
	return new Error(
		'Your session has expired. Sign in again in a new tab, then re-run — your inputs are preserved.'
	);
}

/** `Retry-After` in either RFC form. Null when it names no usable wait. */
function parseRetryAfter(value: string): number | null {
	if (!value.trim()) return null;
	const seconds = Number(value);
	if (!Number.isNaN(seconds)) return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
	const at = Date.parse(value);
	return Number.isNaN(at) ? null : Math.max(0, (at - Date.now()) / 1000);
}

function readRetryAfter(header: string | null, bodyHint: unknown): number | null {
	const seconds =
		(header === null ? null : parseRetryAfter(header)) ??
		(typeof bodyHint === 'number' ? parseRetryAfter(String(bodyHint)) : null);
	return seconds === null ? null : Math.min(seconds, MAX_RETRY_AFTER_S);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseErrorBody(text: string): { message?: string; retryAfter?: unknown } {
	try {
		const body: unknown = JSON.parse(text);
		if (!isPlainObject(body)) return {};
		return {
			...(typeof body.message === 'string' ? { message: body.message } : {}),
			retryAfter: body.retryAfter
		};
	} catch {
		return {};
	}
}

export function createComputeFetchSolveFn<TMesh = unknown>(
	opts: ComputeFetchSolveFnOptions<TMesh>
): SolveFn<TMesh, GrasshopperComputeResponse> {
	const debug = opts.debug ?? false;
	const log = (...args: unknown[]) => {
		if (debug) console.info(...args);
	};

	let cooldownUntil = 0;

	function rateLimited(retryAfterSeconds: number): Error {
		opts.onRateLimited?.(retryAfterSeconds);
		return rateLimitedError(retryAfterSeconds);
	}

	return async (
		values,
		signal,
		call = {}
	): Promise<SolveResult<TMesh, GrasshopperComputeResponse>> => {
		const remainingMs = cooldownUntil - Date.now();
		if (remainingMs > 0) throw rateLimited(remainingMs / 1000);

		const solveStart = performance.now();
		const inputs = opts.inputs();
		const outputs = opts.outputs();
		const channel = opts.channel?.();
		const versionId = opts.versionId?.();
		const streamId = call.liveEvents === false ? null : opts.streamId?.();
		const bearerToken = opts.bearerToken?.();

		const payload = JSON.stringify({
			inputs,
			values,
			definitionUrl: opts.definitionUrl(),
			...(versionId ? { versionId } : channel === 'draft' ? { channel: 'draft' } : {}),
			...(streamId ? { streamId } : {}),
			...(call.solveMode === 'preview' ? { mode: 'preview' } : {})
		});

		let res: Response;
		try {
			res = await fetch(opts.endpoint, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					...(bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {})
				},
				body: payload,
				signal
			});
		} catch (err) {
			if (signal.aborted) {
				log('[Compute] solve aborted during fetch — empty result discarded');
				return { outputs: {} };
			}
			// Also how a redirect to a cross-origin sign-in looks from here, so an expired session
			// stays a possibility.
			throw new Error(
				'Could not reach the server. Check your connection, or reload the page if your session expired.',
				{ cause: err }
			);
		}

		if (signal.aborted) {
			log('[Compute] solve aborted after headers — empty result discarded');
			return { outputs: {} };
		}

		const redirectedToLogin =
			res.redirected && new URL(res.url).pathname === (opts.loginPath ?? '/login');
		if (res.status === 401 || redirectedToLogin) {
			opts.onSessionExpired?.();
			throw sessionExpiredError();
		}

		if (!res.ok) {
			const errorBody = await res.text().catch(() => '');
			const { message, retryAfter: bodyHint } = parseErrorBody(errorBody);
			if (errorBody && message === undefined) {
				log(`[Compute] unreadable error body (HTTP ${res.status}, ${errorBody.length} chars)`);
			}
			// Any status may ask for a wait: a shed 503 says the same thing as a 429, and ignoring it
			// would hit a saturated server hardest at the moment it asks clients to back off.
			const retryAfter = readRetryAfter(res.headers.get('Retry-After'), bodyHint);
			if (retryAfter !== null) cooldownUntil = Date.now() + retryAfter * 1000;
			if (res.status === 503 || res.status === 504) {
				// The server names the failure class (unreachable, bad API key,
				// rate-limited, timed out) — show it rather than a blanket "offline".
				throw new Error(
					message || 'Compute server is offline or unreachable. Please try again later.'
				);
			}
			if (res.status === 429) {
				const seconds = retryAfter ?? DEFAULT_RETRY_AFTER_S;
				cooldownUntil = Date.now() + seconds * 1000;
				throw rateLimited(seconds);
			}
			throw new Error(message || `Compute error (HTTP ${res.status})`);
		}

		const ttfbMs = performance.now() - solveStart;

		const downloadStart = performance.now();
		let bodyText: string;
		try {
			bodyText = await res.text();
		} catch (err) {
			if (signal.aborted) {
				log('[Compute] solve aborted mid-download — empty result discarded');
				return { outputs: {} };
			}
			throw new Error('The connection dropped while receiving the result. Please try again.', {
				cause: err
			});
		}
		const downloadMs = performance.now() - downloadStart;
		const bodyChars = bodyText.length;

		const invalidResponse = (cause?: unknown) =>
			new Error('Received an invalid response from the server. Reload the page and try again.', {
				cause
			});
		let parsed: unknown;
		try {
			parsed = JSON.parse(bodyText);
		} catch (err) {
			throw invalidResponse(err);
		}
		if (!isPlainObject(parsed)) throw invalidResponse();
		const solved = parsed as unknown as GrasshopperComputeResponse;
		const processor = new GrasshopperResponseProcessor(solved);

		// The plugin's own verdict when the fork returned one; otherwise recovered from the
		// markers in Compute's flattened strings (stock server, or a plugin that predates it).
		const outcome =
			decodeOutcome(solved.selva?.outcome) ??
			outcomeFromComputeMessages(solved.errors ?? [], solved.warnings ?? []);
		// Decided before parsing: an older fork still ships a rejected solve's outputs, and the
		// geometry alone can be megabytes the client would only throw away.
		const rejected = outcome.blocked || outcome.aborted;

		const meshes =
			opts.meshes && !rejected && !call.skipMeshes
				? await opts.meshes.extract(processor.response, { debug, signal })
				: [];

		const resultOutputs: Record<string, unknown> = {};
		for (const o of rejected ? [] : outputs) {
			const byId = processor.getValue({ byId: o.id }, { parseValues: true });
			resultOutputs[o.id] =
				byId ??
				(o.nickname
					? processor.getValue({ byName: o.nickname }, { parseValues: true })
					: undefined);
		}

		if (debug) {
			const valuesBytes = JSON.stringify(values).length;
			const serverTiming = parseServerTiming(res.headers.get('Server-Timing'));
			const serverTotal = serverTiming.total ?? 0;
			const networkMs = Math.max(0, ttfbMs - serverTotal);
			const sizeMB = bodyChars / (1024 * 1024);
			const size = sizeMB >= 1 ? `${sizeMB.toFixed(2)} MB` : `${(bodyChars / 1024).toFixed(0)} KB`;
			const mbps = downloadMs > 0 ? (sizeMB / (downloadMs / 1000)).toFixed(1) : '∞';
			const heapBytes = (performance as Performance & { memory?: { usedJSHeapSize: number } })
				.memory?.usedJSHeapSize;
			const heap =
				heapBytes !== undefined ? ` | heap=${(heapBytes / (1024 * 1024)).toFixed(0)} MB` : '';
			log(
				`[Compute] req=${(payload.length / 1024).toFixed(0)}KB (values ${(valuesBytes / 1024).toFixed(0)}KB) | ` +
					`ttfb=${ttfbMs.toFixed(0)}ms (network≈${networkMs.toFixed(0)} + server ${serverTotal.toFixed(0)}) | ` +
					`download=${downloadMs.toFixed(0)}ms (${size} @ ${mbps} MB/s)${heap}`
			);
			if (serverTiming.selva_cache !== undefined) {
				const cacheMsg = serverTiming.selva_cache
					? 'HIT — served without calling compute'
					: serverTiming.rhino_cache
						? "HIT — Rhino.Compute's result cache, solved nothing"
						: 'miss — solved on Rhino.Compute';
				log(`[Compute]   └─ cache: ${cacheMsg}`);
			}
		}

		return finalizeResult({ outputs: resultOutputs, meshes, source: solved }, outcome);
	};
}
