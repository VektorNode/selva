/**
 * A warm compute client caches on server `id`, so a rotated `serverUrl`/`apiKey`
 * keeps the same cache key with stale connection details — it never ages out on
 * its own. The config-write path has to evict explicitly.
 *
 * The eviction sink is a parameter rather than an import: which cache holds the
 * warm clients is the host's decision, and importing one would drag a whole
 * solve engine into every consumer that only wants the diff.
 */

/** The connection-identifying fields — a change in either makes the warm client stale. */
export interface ServerConnection {
	id: string;
	serverUrl: string;
	apiKey?: string;
}

/**
 * Drop the warm client for every server that was removed or whose connection
 * details changed. `prev` and `next` are the scoped server sets before and
 * after the write; unchanged servers are left alone.
 */
export function evictChangedServers(
	prev: readonly ServerConnection[],
	next: readonly ServerConnection[],
	evict: (id: string) => void
): void {
	const nextById = new Map(next.map((s) => [s.id, s]));

	// Removed: no longer in `next`.
	for (const before of prev) {
		if (!nextById.has(before.id)) evict(before.id);
	}

	// Rotated: same id, different URL or key.
	const prevById = new Map(prev.map((s) => [s.id, s]));
	for (const after of next) {
		const before = prevById.get(after.id);
		if (before && (before.serverUrl !== after.serverUrl || before.apiKey !== after.apiKey)) {
			evict(after.id);
		}
	}
}
