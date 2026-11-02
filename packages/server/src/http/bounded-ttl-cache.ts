// Process-local TTL cache with a hard entry cap.
//
// Sweeping is amortized onto `set` rather than driven by a timer: a timer would
// keep the event loop alive and give this module a lifecycle its callers — plain
// module-level singletons — do not have.
//
// Values are stored as-is. A caller that caches failures alongside successes
// encodes both in ONE value type and gives each its own TTL at the `set` call,
// rather than this holding a success/error union it would have to interpret.

export interface BoundedTtlCacheConfig {
	/** Max retained entries. Once full, expired entries go first, then oldest-inserted. */
	maxEntries: number;
}

export interface BoundedTtlCache<T> {
	/** The live value, or `undefined` when absent or expired. Expired entries are dropped on read. */
	get(key: string): T | undefined;
	/** Store `value` under `key`, expiring `ttlMs` from now. Re-inserting a key refreshes its insertion order. */
	set(key: string, value: T, ttlMs: number): void;
	delete(key: string): void;
	/** Test seam and force-refresh gestures. */
	clear(): void;
	/** Retained entries, including any expired but not yet swept. For tests/observability. */
	size(): number;
}

interface Entry<T> {
	value: T;
	expiresAt: number;
}

export function createBoundedTtlCache<T>(config: BoundedTtlCacheConfig): BoundedTtlCache<T> {
	const maxEntries = Math.max(1, Math.floor(config.maxEntries));
	const entries = new Map<string, Entry<T>>();

	function evictIfFull(now: number): void {
		if (entries.size < maxEntries) return;
		for (const [key, entry] of entries) {
			if (entry.expiresAt <= now) entries.delete(key);
		}
		// Map preserves insertion order, so the first key is the oldest-inserted.
		while (entries.size >= maxEntries) {
			const oldest = entries.keys().next().value;
			if (oldest === undefined) break;
			entries.delete(oldest);
		}
	}

	return {
		get(key) {
			const entry = entries.get(key);
			if (!entry) return undefined;
			if (entry.expiresAt <= Date.now()) {
				entries.delete(key);
				return undefined;
			}
			return entry.value;
		},
		set(key, value, ttlMs) {
			// Delete first so a re-insert moves the key to the end of the insertion
			// order — otherwise a hot key keeps its original position and is evicted
			// while colder, newer keys survive.
			entries.delete(key);
			evictIfFull(Date.now());
			entries.set(key, { value, expiresAt: Date.now() + ttlMs });
		},
		delete(key) {
			entries.delete(key);
		},
		clear() {
			entries.clear();
		},
		size() {
			return entries.size;
		}
	};
}
