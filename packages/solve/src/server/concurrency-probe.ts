import type { GrasshopperClient } from '@selvajs/compute/grasshopper';

/**
 * Fallback concurrency while the first probe is still in flight, and the value
 * kept whenever a probe fails or reports 0 — never send more than a single
 * solve to a server whose real capacity is unknown.
 */
const FALLBACK_CONCURRENCY = 1;

/**
 * How stale the compute server's child count may get before a solve triggers a
 * re-read. Short enough that a resized pool is picked up within a few solves,
 * long enough that a busy server is probed rarely — the probe rides on solve
 * completion, so an idle server is never polled at all.
 */
const CONCURRENCY_PROBE_INTERVAL_MS = 5 * 60 * 1000;

export interface ConcurrencyProbe {
	readonly maxConcurrent: number;
	/** One blocking read at connect, so the first solves already use the right cap. */
	refresh(): Promise<void>;
	/** Piggybacks on real traffic: at most once per window, and never on the request path. */
	refreshIfDue(scheduler: { setMaxConcurrent(n: number): void }): void;
}

/**
 * rhino.compute hands out children in strict rotation and never reports "busy", so nothing
 * downstream enforces a concurrency cap — send more than it has children and requests silently
 * double up on one. Rhino.Compute is the only source of truth for its own child count, so this
 * always probes rather than trusting an operator-supplied guess.
 *
 * The count is not static: children exit on their own under `-idlespan`, and `/launch-child` +
 * `/recycle-children` resize the pool at runtime. So the probe re-runs after solves rather than
 * only at connect.
 */
export function createConcurrencyProbe(
	client: Pick<GrasshopperClient, 'serverStats'>,
	debugLog: (message: string) => void
): ConcurrencyProbe {
	let maxConcurrent = FALLBACK_CONCURRENCY;
	let lastProbeAt = 0;
	let probing = false;

	/** `initialize: false` keeps this from spawning children on an idle server, so a cold one reports 0. */
	async function refresh(scheduler?: { setMaxConcurrent(n: number): void }) {
		if (probing) return;
		probing = true;
		try {
			const children = await Promise.resolve(
				client.serverStats?.getActiveChildren({ initialize: false })
			).catch(() => null);
			lastProbeAt = Date.now();
			const next = !children || children <= 0 ? FALLBACK_CONCURRENCY : children;
			if (next === maxConcurrent) return;
			debugLog(
				`[Compute/client-cache] concurrency ${maxConcurrent} → ${next} (server child count)`
			);
			maxConcurrent = next;
			scheduler?.setMaxConcurrent(next);
		} finally {
			probing = false;
		}
	}

	return {
		get maxConcurrent() {
			return maxConcurrent;
		},
		refresh: () => refresh(),
		refreshIfDue(scheduler) {
			if (Date.now() - lastProbeAt >= CONCURRENCY_PROBE_INTERVAL_MS) void refresh(scheduler);
		}
	};
}
