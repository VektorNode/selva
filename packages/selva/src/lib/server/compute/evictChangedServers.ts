/**
 * Compute-client cache invalidation on config write (ADR 0004 Consequences).
 *
 * The client cache keys on server `id`, so a rotated `serverUrl`/`apiKey` keeps
 * the SAME key with stale connection details — it no longer ages out on its own
 * the way the old URL-keyed cache did. The config-write path must therefore
 * evict explicitly: this helper diffs the previous scoped server set against the
 * next one and drops the warm client for every server whose connection details
 * changed or that was removed. Unchanged servers keep their warm client.
 */

import { evictComputeClient } from './engine.server';

/** The connection-identifying fields — a change in either makes the warm client stale. */
export interface ServerConnection {
	id: string;
	serverUrl: string;
	apiKey?: string;
}

/**
 * Evict warm clients for servers whose connection details changed or that were
 * removed. `prev` and `next` are the scoped server sets before/after the write.
 */
export function evictChangedServers(prev: ServerConnection[], next: ServerConnection[]): void {
	const nextById = new Map(next.map((s) => [s.id, s]));

	// Removed servers: no longer in `next` → drop the warm client.
	for (const before of prev) {
		if (!nextById.has(before.id)) evictComputeClient(before.id);
	}

	// Rotated servers: same id, different URL or key → the warm client is stale.
	const prevById = new Map(prev.map((s) => [s.id, s]));
	for (const after of next) {
		const before = prevById.get(after.id);
		if (before && (before.serverUrl !== after.serverUrl || before.apiKey !== after.apiKey)) {
			evictComputeClient(after.id);
		}
	}
}
