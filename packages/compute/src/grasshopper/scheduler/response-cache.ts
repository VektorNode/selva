import { getResponseWireSize } from '@/core/compute-fetch/wire-size';
import { readField } from '@/core/utils/read-field';

import type { GrasshopperComputeResponse } from '../types';
import type { CacheOptions, CacheStats } from './types';

interface CacheEntry {
	response: GrasshopperComputeResponse;
	insertedAt: number;
	/** Wire size (or stringify-fallback estimate) counted against `maxBytes`. */
	sizeBytes: number;
}

/**
 * For a response that never crossed the fetch boundary (custom executor), so carries no
 * wire-size hint. An unserializable response is sized 0 rather than failing the solve.
 */
function estimateResponseSize(response: GrasshopperComputeResponse): number {
	try {
		return JSON.stringify(response)?.length ?? 0;
	} catch {
		return 0;
	}
}

/** The scheduler's response cache: LRU by bytes, with an optional TTL. */
export class ResponseCache {
	private readonly maxBytes: number;
	private readonly ttlMs: number;
	private readonly cacheErroredSolves: boolean;
	private readonly entries = new Map<string, CacheEntry>();
	private bytes = 0;
	private hits = 0;
	private misses = 0;
	private evictions = 0;

	constructor(options: CacheOptions | false | undefined) {
		const config = options || null;
		this.maxBytes = Math.max(0, config?.maxBytes ?? 0);
		this.ttlMs = config?.ttlMs ?? 0;
		this.cacheErroredSolves = config?.cacheErroredSolves ?? true;
	}

	/** A zero budget retains nothing, so it is off rather than a cache that can only ever miss. */
	get enabled(): boolean {
		return this.maxBytes > 0;
	}

	get(key: string): GrasshopperComputeResponse | null {
		if (!this.enabled) return null;
		const entry = this.entries.get(key);
		if (!entry) {
			this.misses += 1;
			return null;
		}
		if (this.ttlMs > 0 && Date.now() - entry.insertedAt > this.ttlMs) {
			this.drop(key);
			this.misses += 1;
			return null;
		}
		// LRU touch
		this.entries.delete(key);
		this.entries.set(key, entry);
		this.hits += 1;
		return entry.response;
	}

	set(key: string, response: GrasshopperComputeResponse): void {
		if (!this.enabled) return;
		const solveErrors = readField<unknown[]>(response, 'errors');
		if (!this.cacheErroredSolves && Array.isArray(solveErrors) && solveErrors.length > 0) return;
		// An aborted solve stopped partway, so the same inputs must solve again. A blocked one is deterministic.
		const outcome = readField(readField(response, 'selva'), 'outcome');
		if (readField(outcome, 'aborted') === true) return;
		const sizeBytes = getResponseWireSize(response) ?? estimateResponseSize(response);
		// Retaining it would evict everything else and then itself.
		if (sizeBytes > this.maxBytes) return;
		this.drop(key); // replace-in-place: release the old copy's bytes
		this.entries.set(key, { response, insertedAt: Date.now(), sizeBytes });
		this.bytes += sizeBytes;
		while (this.bytes > this.maxBytes && this.entries.size > 0) {
			const oldest = this.entries.keys().next().value;
			if (oldest === undefined) break;
			this.drop(oldest);
			this.evictions += 1;
		}
	}

	clear(): void {
		this.entries.clear();
		this.bytes = 0;
	}

	stats(): CacheStats {
		return {
			entries: this.entries.size,
			bytes: this.bytes,
			hits: this.hits,
			misses: this.misses,
			evictions: this.evictions
		};
	}

	private drop(key: string): void {
		const entry = this.entries.get(key);
		if (!entry) return;
		this.entries.delete(key);
		this.bytes -= entry.sizeBytes;
	}
}
