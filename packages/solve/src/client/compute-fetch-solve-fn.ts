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
import { KEEPALIVE_REQUEST_HEADERS, unwrapKeepalive } from './keepalive.js';
import { ASYNC_REQUEST_HEADERS, followAsyncSolve } from './async-solve.js';
import {
	describeComputeProfile,
	describeServerTiming,
	parseServerTiming
} from './server-timing.js';
import { COMPUTE_PROFILE_HEADER } from '../shared/compute-profile.js';
import {
	BINARY_ACCEPT_HEADER,
	decodeBinarySolveResponse,
	isBinarySolveResponse
} from './binary-response.js';

export interface ComputeFetchSolveFnOptions<TMesh = unknown> {
	/** The compute endpoint to POST to, e.g. `/api/compute`. */
	endpoint: string;
	/** Definition URL (or `local:<guid>`) to solve — read per-solve so it can track a route param. */
	definitionUrl: () => string;
	/**
	 * Schema input params, sent as the request body's `inputs`. Only a remote `definitionUrl` needs
	 * them: a stored definition's server reads its own, so leave this out for `local:` and save the bytes.
	 */
	inputs?: () => Array<{ id: string }>;
	/** Schema output params — drives byId/byName output extraction after a solve. */
	outputs: () => Array<{ id: string; nickname?: string }>;
	channel?: () => 'live' | 'draft' | undefined;
	versionId?: () => string | null | undefined;
	/** The tab's live-event stream id (`createSolveEventStream().streamId`), so the server routes this solve's events to it. */
	streamId?: () => string | null | undefined;
	/** Sent as `Authorization: Bearer …`, e.g. a share-link token. A header, not the URL, so it stays out of access logs. */
	bearerToken?: () => string | null | undefined;
	/**
	 * Omit entirely for a non-viewer consumer — `meshes` on the result stays `[]`. Set, the solve
	 * asks for a binary response: each display item's `data` in `source` is then the parsed batch,
	 * not a JSON string, and its mesh bytes are dropped once `extract` returns.
	 */
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
	/**
	 * Ask the server to hold a long solve open with keep-alive bytes, so a reverse proxy's read
	 * timeout can't cut it. A server without support ignores the ask. Sends a `Prefer` header,
	 * which a cross-origin endpoint must allow in CORS. Default `false`.
	 */
	keepalive?: boolean;
	/**
	 * Ask the server to run the solve detached and poll for the result, so no proxy timeout can
	 * cut a long one however it counts. Wins over `keepalive` on a server that supports both; a
	 * server without support ignores the ask. Sends a `Prefer` header. Default `false`.
	 */
	respondAsync?: boolean;
}

/** Said once a page: the same Compute server stays silent on every solve. */
let warnedNoRhinoTiming = false;

function formatBytes(bytes: number): string {
	if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	return `${(bytes / 1024).toFixed(0)} KB`;
}

/** Applied to a 429 that names no wait. */
const DEFAULT_RETRY_AFTER_S = 5;
/** A server's hint, not a lock: past this the client tries again anyway. */
const MAX_RETRY_AFTER_S = 3600;

/**
 * The server refused the solve. `message` is the text to show; branch on `status` and `code`
 * instead of matching it. A solve refused locally during a 429 cooldown has `status` 429 and no
 * `body`; a redirect to the sign-in page has `status` 401.
 */
export class SolveRequestError extends Error {
	override readonly name = 'SolveRequestError';
	readonly status: number;
	/** The response body parsed as JSON, or undefined when it was empty or not JSON. */
	readonly body: unknown;
	/** The body's `code`, or its `reason` when it has no `code`. */
	readonly code: string | undefined;
	readonly retryAfterSeconds: number | undefined;

	constructor(
		message: string,
		init: { status: number; body?: unknown; retryAfterSeconds?: number | null }
	) {
		super(message);
		this.status = init.status;
		this.body = init.body;
		this.code = readCode(init.body);
		this.retryAfterSeconds = init.retryAfterSeconds ?? undefined;
	}
}

function readCode(body: unknown): string | undefined {
	if (!isPlainObject(body)) return undefined;
	if (typeof body.code === 'string') return body.code;
	return typeof body.reason === 'string' ? body.reason : undefined;
}

function rateLimitedError(retryAfterSeconds: number, body?: unknown): SolveRequestError {
	return new SolveRequestError(
		`Rate limit reached. Try again in ${Math.ceil(retryAfterSeconds)}s.`,
		{ status: 429, body, retryAfterSeconds }
	);
}

function sessionExpiredError(body: unknown): SolveRequestError {
	return new SolveRequestError(
		'Your session has expired. Sign in again in a new tab, then re-run — your inputs are preserved.',
		{ status: 401, body }
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

function parseErrorBody(text: string): { body?: unknown; message?: string; retryAfter?: unknown } {
	let body: unknown;
	try {
		body = JSON.parse(text);
	} catch {
		return {};
	}
	if (!isPlainObject(body)) return { body };
	return {
		body,
		...(typeof body.message === 'string' ? { message: body.message } : {}),
		retryAfter: body.retryAfter
	};
}

export function createComputeFetchSolveFn<TMesh = unknown>(
	opts: ComputeFetchSolveFnOptions<TMesh>
): SolveFn<TMesh, GrasshopperComputeResponse> {
	const debug = opts.debug ?? false;
	const log = (...args: unknown[]) => {
		if (debug) console.info(...args);
	};

	let cooldownUntil = 0;

	function rateLimited(retryAfterSeconds: number, body?: unknown): SolveRequestError {
		opts.onRateLimited?.(retryAfterSeconds);
		return rateLimitedError(retryAfterSeconds, body);
	}

	return async (
		values,
		signal,
		call = {}
	): Promise<SolveResult<TMesh, GrasshopperComputeResponse>> => {
		const remainingMs = cooldownUntil - Date.now();
		if (remainingMs > 0) throw rateLimited(remainingMs / 1000);

		const solveStart = performance.now();
		const inputs = opts.inputs?.();
		const outputs = opts.outputs();
		const channel = opts.channel?.();
		const versionId = opts.versionId?.();
		const streamId = call.liveEvents === false ? null : opts.streamId?.();
		const bearerToken = opts.bearerToken?.();

		const payload = JSON.stringify({
			...(inputs ? { inputs } : {}),
			values,
			definitionUrl: opts.definitionUrl(),
			...(versionId ? { versionId } : channel === 'draft' ? { channel: 'draft' } : {}),
			...(streamId ? { streamId } : {}),
			...(call.solveMode === 'preview' ? { mode: 'preview' } : {})
		});

		const auth: Record<string, string> = bearerToken
			? { Authorization: `Bearer ${bearerToken}` }
			: {};
		const prefer = [
			...(opts.respondAsync ? [ASYNC_REQUEST_HEADERS.Prefer] : []),
			...(opts.keepalive ? [KEEPALIVE_REQUEST_HEADERS.Prefer] : [])
		].join(', ');

		type Sent = { res: Response; redirectedToLogin: boolean; lost: boolean };
		// Null when the caller aborted. `lost`: the solve ran detached and the server no longer
		// knows its id, as after a restart or an update. Its own result is gone with it.
		const send = async (): Promise<Sent | null> => {
			let res: Response;
			try {
				res = await fetch(opts.endpoint, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						// Only a viewer reads the mesh blobs, and only it is handed them as bytes.
						...(opts.meshes && BINARY_ACCEPT_HEADER ? { Accept: BINARY_ACCEPT_HEADER } : {}),
						...auth,
						...(prefer ? { Prefer: prefer } : {})
					},
					body: payload,
					signal
				});
			} catch (err) {
				if (signal.aborted) {
					log('[Compute] solve aborted during fetch — empty result discarded');
					return null;
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
				return null;
			}

			const redirectedToLogin =
				res.redirected && new URL(res.url).pathname === (opts.loginPath ?? '/login');
			try {
				res = await unwrapKeepalive(res);
			} catch (err) {
				if (signal.aborted) {
					log('[Compute] solve aborted while the server held it — empty result discarded');
					return null;
				}
				throw new Error('The connection dropped while waiting for the result. Please try again.', {
					cause: err
				});
			}
			const followed = await followAsyncSolve(res, { headers: auth, signal });
			if (!followed) {
				log('[Compute] solve aborted while it ran detached — empty result discarded');
				return null;
			}
			return {
				res: followed,
				redirectedToLogin,
				lost: followed !== res && followed.status === 404
			};
		};

		let sent = await send();
		if (sent?.lost) {
			// Once: a solve the server forgot twice in a row is a real fault, not a restart.
			log('[Compute] the server lost the running solve (restart or update?) — sending it again');
			sent = await send();
		}
		if (!sent) return { outputs: {} };
		const res = sent.res;
		const { redirectedToLogin } = sent;
		if (res.status === 401 || redirectedToLogin) {
			opts.onSessionExpired?.();
			const body = redirectedToLogin
				? undefined
				: parseErrorBody(await res.text().catch(() => '')).body;
			throw sessionExpiredError(body);
		}

		if (!res.ok) {
			const errorBody = await res.text().catch(() => '');
			const { body, message, retryAfter: bodyHint } = parseErrorBody(errorBody);
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
				throw new SolveRequestError(
					message || 'Compute server is offline or unreachable. Please try again later.',
					{ status: res.status, body, retryAfterSeconds: retryAfter }
				);
			}
			if (res.status === 429) {
				const seconds = retryAfter ?? DEFAULT_RETRY_AFTER_S;
				cooldownUntil = Date.now() + seconds * 1000;
				throw rateLimited(seconds, body);
			}
			throw new SolveRequestError(message || `Compute error (HTTP ${res.status})`, {
				status: res.status,
				body,
				retryAfterSeconds: retryAfter
			});
		}

		const ttfbMs = performance.now() - solveStart;

		const binary = isBinarySolveResponse(res);
		const downloadStart = performance.now();
		let body: string | Uint8Array;
		try {
			body = binary ? new Uint8Array(await res.arrayBuffer()) : await res.text();
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
		// What crossed the network: a binary body exactly, a gzip one only while its header survives.
		const wireBytes =
			typeof body === 'string'
				? Number(res.headers.get('Content-Length')) || null
				: body.byteLength;

		const invalidResponse = (cause?: unknown) =>
			new Error('Received an invalid response from the server. Reload the page and try again.', {
				cause
			});
		const parseStart = performance.now();
		let parsed: unknown;
		let releaseBlobs = () => {};
		try {
			if (typeof body === 'string') parsed = JSON.parse(body);
			else ({ response: parsed, releaseBlobs } = await decodeBinarySolveResponse(body));
		} catch (err) {
			throw invalidResponse(err);
		}
		const parseMs = performance.now() - parseStart;
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

		const meshesStart = performance.now();
		const meshes =
			opts.meshes && !rejected && !call.skipMeshes
				? await opts.meshes.extract(processor.response, { debug, signal })
				: [];
		const meshesMs = performance.now() - meshesStart;
		releaseBlobs();

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
			const timingHeader = res.headers.get('Server-Timing');
			const serverTiming = parseServerTiming(timingHeader);
			const serverTotal = serverTiming.total ?? 0;
			const networkMs = Math.max(0, ttfbMs - serverTotal);
			const heapBytes = (performance as Performance & { memory?: { usedJSHeapSize: number } })
				.memory?.usedJSHeapSize;
			const heap = heapBytes !== undefined ? ` | heap=${formatBytes(heapBytes)}` : '';
			log(
				`[Compute] req=${formatBytes(payload.length)} (values ${formatBytes(valuesBytes)}) | ` +
					`ttfb=${ttfbMs.toFixed(0)}ms (network≈${networkMs.toFixed(0)} + server ${serverTotal.toFixed(0)})${heap}`
			);
			const breakdown = describeServerTiming(timingHeader);
			if (breakdown) log(`[Compute]   └─ server: ${breakdown}`);
			const slowest = describeComputeProfile(res.headers.get(COMPUTE_PROFILE_HEADER));
			if (slowest) log(`[Compute]   └─ slowest components (ms): ${slowest}`);
			if (serverTiming.selva_cache !== undefined) {
				const cacheMsg = serverTiming.selva_cache
					? 'HIT — served without calling compute'
					: serverTiming.rhino_cache
						? "HIT — Rhino.Compute's result cache, solved nothing"
						: 'miss — solved on Rhino.Compute';
				log(`[Compute]   └─ cache: ${cacheMsg}`);
			}
			if (
				!serverTiming.selva_cache &&
				(serverTiming.solve ?? 0) > 0 &&
				serverTiming.rhino_solve === undefined &&
				!warnedNoRhinoTiming
			) {
				warnedNoRhinoTiming = true;
				log(
					'[Compute]   └─ note: Rhino.Compute sent no timing of its own, so `compute` above ' +
						'is Grasshopper, definition load and queue wait together. A recent VektorNode fork ' +
						'sends it, with the slowest components.'
				);
			}
			const bodyBytes =
				typeof body === 'string' ? new TextEncoder().encode(body).byteLength : body.byteLength;
			const wire =
				wireBytes === null
					? `${formatBytes(bodyBytes)} ${binary ? 'binary' : 'json'}`
					: `${formatBytes(wireBytes)} ${binary ? 'binary' : 'json'} on the wire` +
						(binary ? '' : `, ${formatBytes(bodyBytes)} unpacked`);
			const rateBytes = wireBytes ?? bodyBytes;
			const rate = downloadMs > 0 ? `${formatBytes(rateBytes / (downloadMs / 1000))}/s` : '∞';
			log(
				`[Compute]   └─ client: download ${downloadMs.toFixed(0)}ms (${wire} @ ${rate}) | ` +
					`parse ${parseMs.toFixed(0)}ms | meshes ${meshesMs.toFixed(0)}ms (${meshes.length} objects)`
			);
		}

		return finalizeResult({ outputs: resultOutputs, meshes, source: solved }, outcome);
	};
}
