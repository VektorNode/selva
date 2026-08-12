/**
 * Remote-definition fetch: SSRF-guarded, size-capped, timed, and TTL-cached.
 *
 * A solve can reference its `.gh` by remote URL instead of a stored blob, and
 * that URL is attacker-controllable — a share-token caller supplies
 * `definitionUrl`. Hence {@link assertSafeRemoteDefinitionUrl}, the early size
 * cap, and the deadline.
 */

import { assertSafeRemoteDefinitionUrl } from './safe-url.js';
import { NoopLogger, type ILogger } from '@selvajs/platform';

/** Injected limits — the app derives these from its env-resolved `ComputeLimits`. */
export interface RemoteDefinitionConfig {
	/** Hard cap on the fetched body; a lying/absent content-length can't exceed it. */
	maxBytes: number;
	/** Deadline on the fetch (slow-loris protection). */
	fetchTimeoutMs: number;
	/** How long a fetched definition stays warm in the in-process cache. */
	cacheTtlMs: number;
	/** Current epoch millis. Injected so the TTL is testable; the app passes `() => Date.now()`. */
	now: () => number;
	/**
	 * Receives the SSRF guard's block diagnostics. Defaults to `NoopLogger` so an
	 * embedder that wires nothing gets silence rather than unsolicited stdout writes.
	 */
	logger?: ILogger;
}

export interface RemoteDefinitionFetcher {
	/**
	 * Fetch (or return cached) `.gh` bytes for a remote URL. Throws on an unsafe
	 * host, a non-2xx response, an oversized body, or a timeout — the caller maps
	 * the failure to a 400.
	 */
	load(url: string): Promise<Uint8Array>;
}

/** Once the cache exceeds this many entries, evict the oldest 10 by `fetchedAt`. */
const CACHE_MAX_ENTRIES = 50;
const CACHE_EVICT_BATCH = 10;

/**
 * Read a response body into memory, aborting (and throwing) as soon as the
 * running byte total exceeds `maxBytes`. Falls back to `arrayBuffer()` only when
 * the body isn't a readable stream (older fetch impls).
 */
export async function readBodyWithCap(
	response: Response,
	maxBytes: number,
	controller: AbortController
): Promise<Uint8Array> {
	if (!response.body) {
		const buffer = await response.arrayBuffer();
		if (buffer.byteLength > maxBytes) throw new Error('Remote definition exceeds size limit');
		return new Uint8Array(buffer);
	}

	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > maxBytes) {
			controller.abort();
			throw new Error('Remote definition exceeds size limit');
		}
		chunks.push(value);
	}

	const out = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return out;
}

/**
 * Build a remote-definition fetcher owning its own TTL cache. Each fetcher's
 * cache is independent, so one per process shares warm bytes while test fetchers
 * stay isolated.
 */
export function createRemoteDefinitionFetcher(
	config: RemoteDefinitionConfig
): RemoteDefinitionFetcher {
	const cache = new Map<string, { data: Uint8Array; fetchedAt: number }>();
	const logger = config.logger ?? new NoopLogger();

	return {
		async load(url: string): Promise<Uint8Array> {
			// Before the cache read, not after: a URL must never serve warm bytes
			// without passing the guard.
			await assertSafeRemoteDefinitionUrl(url, logger);

			const now = config.now();
			const cached = cache.get(url);
			if (cached && now - cached.fetchedAt < config.cacheTtlMs) {
				return cached.data;
			}

			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), config.fetchTimeoutMs);
			let data: Uint8Array;
			try {
				const response = await fetch(url, {
					signal: controller.signal,
					redirect: 'error'
				});
				if (!response.ok) {
					throw new Error(`HTTP ${response.status}: ${response.statusText}`);
				}
				// Reject early when the server declares an oversized body.
				const declared = Number(response.headers.get('content-length'));
				if (Number.isFinite(declared) && declared > config.maxBytes) {
					throw new Error('Remote definition exceeds size limit');
				}
				// Stream and count rather than `arrayBuffer()` — a missing or lying
				// content-length must not let an unbounded body buffer into memory
				// before the cap is checked. Aborts the moment we cross the limit.
				data = await readBodyWithCap(response, config.maxBytes, controller);
			} finally {
				clearTimeout(timeout);
			}

			cache.set(url, { data, fetchedAt: now });

			if (cache.size > CACHE_MAX_ENTRIES) {
				const entries = Array.from(cache.entries());
				entries.sort((a, b) => a[1].fetchedAt - b[1].fetchedAt);
				for (let i = 0; i < CACHE_EVICT_BATCH; i++) {
					cache.delete(entries[i][0]);
				}
			}

			return data;
		}
	};
}
