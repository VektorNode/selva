/**
 * Per-request timing: where a request's wall time went, as named spans plus every outbound
 * fetch grouped by upstream. One AsyncLocalStorage store per request, opened by `timeRequest`
 * in the host's handle hook. The result goes out twice: a `Server-Timing` header on the
 * response, and one structured record through `log` for a request that is slow, sampled, or the
 * first the process served.
 *
 * Fetch time is time to response headers, not body: round-trip latency, which a chain of
 * sequential awaits multiplies. Parallel fetches overlap, so a bucket's `ms` is a sum and can
 * exceed the request's wall time.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

/** Which upstream a fetch reached, and optionally the table or endpoint within it. */
export interface Upstream {
	key: string;
	target?: string;
}

export interface TimedRequest {
	method: string;
	/** The route id (`/s/[token]`), so records aggregate across ids; the path when unrouted. */
	route: string;
	isDataRequest?: boolean;
}

export interface RequestTimingOptions {
	/** Writes one record. Fields are typed JSON; never put payload values in them. */
	log: (message: string, fields: Record<string, unknown>) => void;
	/** Names the upstream of a fetch; unnamed ones bucket by host. */
	upstream?: (url: URL) => Upstream | undefined;
	/** A request at or over this is logged. Default 200 ms. */
	slowMs?: number;
	/**
	 * This share of requests is logged whatever its time, marked `sampled`: slow-only records
	 * lean toward whatever got slower, the sampled ones compare across a change. Default 0.1.
	 */
	sampleRate?: number;
	/** Stamped on every record, e.g. the revision; `instance` is added per process. */
	labels?: Record<string, string>;
}

export interface RequestTiming {
	/**
	 * Runs one request inside a timing store, stamps `Server-Timing` on its response and logs it
	 * when due. A throw (a framework redirect included) is logged and rethrown.
	 */
	timeRequest(req: TimedRequest, fn: () => Promise<Response>): Promise<Response>;
	/** Times `fn` as a named span of the current request; outside a request it just runs. */
	span<T>(name: string, fn: () => Promise<T> | T): Promise<T>;
	/** Attaches facts to the current request's record; a no-op outside a request. */
	fact(facts: Record<string, unknown>): void;
	/** Whether the current request is the first this process served. */
	isCold(): boolean;
	/** Called once the server can take requests: the cold-start record's `bootMs`. */
	markBooted(): void;
	/** Wraps the global `fetch` once; clients that look it up at call time are then timed. */
	instrumentFetch(): void;
}

/** `calls` holds each call's ms, for the record's per-call median and max. */
type Bucket = { count: number; ms: number; calls: number[] };

interface Store {
	spans: { name: string; ms: number }[];
	upstream: Map<string, Bucket>;
	targets: Map<string, number>;
	/** Attempts a client re-sent after a failed one (`X-Retry-Count`). */
	retries: number;
	facts: Record<string, unknown>;
	cold: boolean;
}

const round = (ms: number) => Math.round(ms);

function median(values: number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	const mid = sorted.length >> 1;
	return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function urlOf(input: Parameters<typeof fetch>[0]): URL | undefined {
	try {
		return new URL(input instanceof Request ? input.url : String(input));
	} catch {
		return undefined;
	}
}

function isRetry(init: Parameters<typeof fetch>[1]): boolean {
	const headers = init?.headers;
	if (!headers) return false;
	if (headers instanceof Headers) return headers.has('x-retry-count');
	if (Array.isArray(headers)) return headers.some(([k]) => k.toLowerCase() === 'x-retry-count');
	return Object.keys(headers).some((k) => k.toLowerCase() === 'x-retry-count');
}

/** Parses a `Server-Timing` value into `{ name: ms }`, a desc-only entry into `{ name: desc }`. */
export function parseServerTimingHeader(
	header: string | null | undefined
): Record<string, number | string> {
	const out: Record<string, number | string> = {};
	for (const entry of header?.split(',') ?? []) {
		const [name, ...params] = entry.trim().split(';');
		if (!name) continue;
		for (const p of params) {
			const [k, v = ''] = p.trim().split('=');
			if (k === 'dur') out[name] = round(Number(v));
			else if (k === 'desc' && !(name in out)) out[name] = v.replace(/^"|"$/g, '');
		}
	}
	return out;
}

export function createRequestTiming(options: RequestTimingOptions): RequestTiming {
	const slowMs = options.slowMs ?? 200;
	const sampleRate = options.sampleRate ?? 0.1;
	const labels = { instance: randomUUID().slice(0, 8), ...options.labels };
	const als = new AsyncLocalStorage<Store>();
	let bootMs: number | null = null;
	let served = false;
	let installed = false;

	const log = (message: string, fields: Record<string, unknown>) => {
		try {
			options.log(message, { ...labels, ...fields });
		} catch {
			// Telemetry never fails a request.
		}
	};

	function upstreamOf(url: URL | undefined): Upstream {
		if (!url) return { key: 'other' };
		return options.upstream?.(url) ?? { key: url.host };
	}

	/** An upstream that times itself (`Server-Timing`) lands on the record by path. */
	function recordUpstreamTiming(store: Store, url: URL | undefined, response: Response): void {
		const timing = response.headers.get('server-timing');
		if (!timing || !url) return;
		const byPath = (store.facts.upstreamTiming as Record<string, unknown> | undefined) ?? {};
		byPath[url.pathname] = parseServerTimingHeader(timing);
		store.facts.upstreamTiming = byPath;
	}

	function serverTiming(store: Store, totalMs: number): string {
		const parts = store.spans.map(
			(s) => `app_${s.name.replace(/[^\w-]/g, '_')};dur=${s.ms.toFixed(1)}`
		);
		for (const [key, b] of store.upstream) {
			parts.push(`up;desc="${key} x${b.count}";dur=${b.ms.toFixed(1)}`);
		}
		if (store.retries > 0) parts.push(`retries;desc="${store.retries}"`);
		parts.push(`app_total;dur=${totalMs.toFixed(1)}`);
		return parts.join(', ');
	}

	function logTiming(
		req: TimedRequest,
		status: number | 'thrown',
		totalMs: number,
		store: Store,
		sampled: boolean
	): void {
		const upstream = Object.fromEntries(
			[...store.upstream].map(([k, b]) => [
				k,
				{
					count: b.count,
					ms: round(b.ms),
					p50: round(median(b.calls)),
					max: round(Math.max(...b.calls))
				}
			])
		);
		// A span name that ran more than once sums.
		const spans: Record<string, number> = {};
		for (const s of store.spans) spans[s.name] = round((spans[s.name] ?? 0) + s.ms);
		log(
			`[timing] ${req.method} ${req.route}${req.isDataRequest ? ' (data)' : ''} ${status} ${round(totalMs)}ms`,
			{
				timing: {
					route: req.route,
					method: req.method,
					data: req.isDataRequest ?? false,
					status,
					totalMs: round(totalMs),
					...(store.cold && { cold: true }),
					...(sampled && { sampled: true }),
					spans,
					upstream,
					calls: Object.fromEntries(store.targets),
					...(store.retries > 0 && { retries: store.retries }),
					...store.facts
				}
			}
		);
	}

	return {
		async timeRequest(req, fn) {
			const cold = !served;
			served = true;
			const store: Store = {
				spans: [],
				upstream: new Map(),
				targets: new Map(),
				retries: 0,
				facts: {},
				cold
			};
			const start = performance.now();
			if (cold) {
				// Process start to `markBooted`, and to this request: their gap is idle time.
				log(`[coldstart] ${req.method} ${req.route}`, {
					coldstart: { bootMs, firstRequestMs: round(start), route: req.route }
				});
			}
			let status: number | 'thrown' = 'thrown';
			try {
				const response = await als.run(store, fn);
				status = response.status;
				try {
					response.headers.append('Server-Timing', serverTiming(store, performance.now() - start));
				} catch {
					// Immutable headers (a fetched Response passed through): the record still has it.
				}
				return response;
			} finally {
				const totalMs = performance.now() - start;
				const sampled = Math.random() < sampleRate;
				// The cold request always: a comparison across a change must be able to drop it.
				if (cold || sampled || totalMs >= slowMs) logTiming(req, status, totalMs, store, sampled);
			}
		},

		async span(name, fn) {
			const store = als.getStore();
			if (!store) return fn();
			const start = performance.now();
			try {
				return await fn();
			} finally {
				store.spans.push({ name, ms: performance.now() - start });
			}
		},

		fact(facts) {
			const store = als.getStore();
			if (store) Object.assign(store.facts, facts);
		},

		isCold: () => als.getStore()?.cold ?? false,

		markBooted() {
			bootMs ??= round(performance.now());
		},

		instrumentFetch() {
			if (installed) return;
			installed = true;
			const original = globalThis.fetch;
			globalThis.fetch = async (input, init) => {
				const store = als.getStore();
				if (!store) return original(input, init);
				const start = performance.now();
				const url = urlOf(input);
				const { key, target } = upstreamOf(url);
				if (target) store.targets.set(target, (store.targets.get(target) ?? 0) + 1);
				if (isRetry(init)) store.retries += 1;
				try {
					const response = await original(input, init);
					recordUpstreamTiming(store, url, response);
					return response;
				} finally {
					const bucket = store.upstream.get(key) ?? { count: 0, ms: 0, calls: [] };
					const ms = performance.now() - start;
					bucket.count += 1;
					bucket.ms += ms;
					bucket.calls.push(ms);
					store.upstream.set(key, bucket);
				}
			};
		}
	};
}
