/**
 * The client cache keys on server `id`, so a rotated `serverUrl`/`apiKey` keeps
 * the same key with stale connection details — it won't age out on its own. The
 * config-write path must evict explicitly: this diffs the previous scoped server
 * set against the next one and drops the warm client for every server whose
 * connection details changed or that was removed. Unchanged servers are untouched.
 */

import { evictComputeClient } from './engine.server';

/** The connection-identifying fields — a change in either makes the warm client stale. */
export interface ServerConnection {
	id: string;
	serverUrl: string;
	apiKey?: string;
}

/**
 * `prev` and `next` are the scoped server sets before/after the write.
 */
export function evictChangedServers(prev: ServerConnection[], next: ServerConnection[]): void {
	const nextById = new Map(next.map((s) => [s.id, s]));

	// Removed: no longer in `next`.
	for (const before of prev) {
		if (!nextById.has(before.id)) evictComputeClient(before.id);
	}

	// Rotated: same id, different URL or key.
	const prevById = new Map(prev.map((s) => [s.id, s]));
	for (const after of next) {
		const before = prevById.get(after.id);
		if (before && (before.serverUrl !== after.serverUrl || before.apiKey !== after.apiKey)) {
			evictComputeClient(after.id);
		}
	}
}
