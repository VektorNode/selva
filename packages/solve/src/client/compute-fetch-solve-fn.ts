/**
 * `createComputeFetchSolveFn` — a ready-made `SolveFn` that POSTs to a
 * `/api/compute`-shaped HTTP endpoint (the wire contract `runSolvePipeline` +
 * `SolveEngine` produce server-side) and unpacks the result.
 *
 * Ports the resilience behavior an interactive solve endpoint needs regardless
 * of app — 429 cooldown, session-expiry/redirect detection, non-JSON-response
 * guarding, and abort handling at every await point — so a new consumer gets it
 * for free instead of re-deriving it by hand. Mesh decoding is NOT built in:
 * this package stays renderer-agnostic (see `shared/solve-fn.ts`), so a
 * viewer-enabled consumer supplies its own `meshes.extract` hook (typically
 * `getThreeMeshesFromComputeResponse` from `@selvajs/visualization/parse`).
 */

import {
	GrasshopperResponseProcessor,
	type GrasshopperComputeResponse
} from '@selvajs/compute/grasshopper';
import type { SolveFn, SolveResult } from '../shared/solve-fn.js';

export interface ComputeFetchSolveFnOptions<TMesh = unknown> {
	/** The compute endpoint to POST to, e.g. `/api/compute`. */
	endpoint: string;
	/** Definition URL (or `local:<guid>`) to solve — read per-solve so it can track a route param. */
	definitionUrl: () => string;
	/** Schema input params, sent as the request body's `inputs`. */
	inputs: () => Array<{ id: string }>;
	/** Schema output params — drives byId/byName output extraction after a solve. */
	outputs: () => Array<{ id: string; nickname?: string }>;
	channel?: () => 'live' | 'draft' | undefined;
	versionId?: () => string | null | undefined;
	/** Omit entirely for a non-viewer consumer — `meshes` on the result stays `[]`. */
	meshes?: {
		extract: (
			response: GrasshopperComputeResponse,
			opts: { debug: boolean }
		) => TMesh[] | Promise<TMesh[]>;
	};
	/** Gates ALL console telemetry (timing, cache verdicts, whales, heap). Default `false`. */
	debug?: boolean;
	/** Called on a 429. Default: throws a cooldown-aware Error; the cooldown itself is tracked either way. */
	onRateLimited?: (retryAfterSeconds: number) => void;
	/** Called on a 401 or a login-page redirect. Default: throws an actionable "reload to sign in again" Error. */
	onSessionExpired?: () => void;
}

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

const defaultOnRateLimited = (retryAfterSeconds: number): never => {
	throw new Error(`Rate limit reached. Try again in ${Math.ceil(retryAfterSeconds)}s.`);
};

const defaultOnSessionExpired = (): never => {
	throw new Error(
		'Your session has expired. Sign in again in a new tab, then re-run — your inputs are preserved.'
	);
};

export function createComputeFetchSolveFn<TMesh = unknown>(
	opts: ComputeFetchSolveFnOptions<TMesh>
): SolveFn<TMesh, GrasshopperComputeResponse> {
	const debug = opts.debug ?? false;
	const log = (...args: unknown[]) => {
		if (debug) console.info(...args);
	};

	let cooldownUntil = 0;

	return async (values, signal): Promise<SolveResult<TMesh, GrasshopperComputeResponse>> => {
		const remainingMs = cooldownUntil - Date.now();
		if (remainingMs > 0) {
			throw new Error(`Rate limit reached. Try again in ${Math.ceil(remainingMs / 1000)}s.`);
		}

		const solveStart = performance.now();
		const inputs = opts.inputs();
		const outputs = opts.outputs();
		const channel = opts.channel?.();
		const versionId = opts.versionId?.();

		const payload = JSON.stringify({
			inputs,
			values,
			definitionUrl: opts.definitionUrl(),
			...(versionId ? { versionId } : channel === 'draft' ? { channel: 'draft' } : {})
		});

		let res: Response;
		try {
			res = await fetch(opts.endpoint, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: payload,
				signal
			});
		} catch (err) {
			if (signal.aborted) {
				log('[Compute] solve aborted during fetch — empty result discarded');
				return { outputs: {} };
			}
			throw new Error(
				'Request blocked — your session may have expired. Reload the page to sign in again.',
				{ cause: err }
			);
		}

		if (signal.aborted) {
			log('[Compute] solve aborted after headers — empty result discarded');
			return { outputs: {} };
		}

		const redirectedToLogin = res.redirected && new URL(res.url).pathname === '/login';
		if (res.status === 401 || redirectedToLogin) {
			(opts.onSessionExpired ?? defaultOnSessionExpired)();
		}

		if (!res.ok) {
			if (res.status === 503) {
				throw new Error('Compute server is offline or unreachable. Please try again later.');
			}
			const errorBody = await res.text().catch(() => '');
			let d: { message?: string; retryAfter?: number } = {};
			try {
				d = JSON.parse(errorBody);
			} catch {
				if (errorBody) {
					console.warn(
						`[Compute] non-JSON error body (HTTP ${res.status}):`,
						errorBody.slice(0, 300)
					);
				}
			}
			if (res.status === 429) {
				const retryAfter = Number(res.headers.get('Retry-After')) || Number(d.retryAfter) || 5;
				cooldownUntil = Date.now() + retryAfter * 1000;
				(opts.onRateLimited ?? defaultOnRateLimited)(retryAfter);
			}
			throw new Error(d.message || `Compute error (HTTP ${res.status})`);
		}

		const ttfbMs = performance.now() - solveStart;

		const downloadStart = performance.now();
		const bodyText = await res.text();
		if (signal.aborted) {
			log('[Compute] solve aborted mid-download — empty result discarded');
			return { outputs: {} };
		}
		const downloadMs = performance.now() - downloadStart;
		const bytes = bodyText.length;

		let solved: GrasshopperComputeResponse;
		try {
			solved = JSON.parse(bodyText);
		} catch (err) {
			throw new Error(
				'Received an invalid response from the server. Reload the page and try again.',
				{
					cause: err
				}
			);
		}
		const processor = new GrasshopperResponseProcessor(solved, false);

		const meshes = opts.meshes ? await opts.meshes.extract(processor.response, { debug }) : [];

		const resultOutputs: Record<string, unknown> = {};
		for (const o of outputs) {
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
			const sizeMB = bytes / (1024 * 1024);
			const size = sizeMB >= 1 ? `${sizeMB.toFixed(2)} MB` : `${(bytes / 1024).toFixed(0)} KB`;
			const mbps = downloadMs > 0 ? (sizeMB / (downloadMs / 1000)).toFixed(1) : '∞';
			const heapMB = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory
				?.usedJSHeapSize;
			const heap = heapMB !== undefined ? ` | heap=${(heapMB / (1024 * 1024)).toFixed(0)} MB` : '';
			log(
				`[Compute] req=${(payload.length / 1024).toFixed(0)}KB (values ${(valuesBytes / 1024).toFixed(0)}KB) | ` +
					`ttfb=${ttfbMs.toFixed(0)}ms (network≈${networkMs.toFixed(0)} + server ${serverTotal.toFixed(0)}) | ` +
					`download=${downloadMs.toFixed(0)}ms (${size} @ ${mbps} MB/s)${heap}`
			);
			if (serverTiming.selva_cache !== undefined) {
				const cacheMsg = serverTiming.selva_cache
					? 'HIT — served without calling compute'
					: 'miss — solved on Rhino.Compute';
				log(`[Compute]   └─ cache: ${cacheMsg}`);
			}
		}

		return {
			outputs: resultOutputs,
			meshes,
			errors: solved.errors ?? [],
			warnings: solved.warnings ?? [],
			source: solved
		};
	};
}
