import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAsyncThrottle } from '../async-throttle.js';

// ============================================================================
// What one slider drag actually costs, in requests
// ============================================================================
//
// This file exists because THREE successive static readings of the slider→solve
// path reached three different wrong conclusions about whether a drag can trip the
// server's rate limit (120 requests / 100s per user). The history is in
// plans/archive/verify-slider-drag-solve-path.md; the short version:
//
//   1. "~6.6 solves/sec"      — read the 150ms debounce, missed that it's trailing-edge.
//   2. "bounded by 1/RTT"     — read the throttle as a rate limiter. It isn't; it bounds
//                               CONCURRENCY. A debounce fire landing while nothing is in
//                               flight starts a request immediately.
//   3. "narrow, needs a ~100s pathological pattern" — followed from (2).
//
// So the rate is asserted here by DRIVING the real limiters with fake timers rather
// than by reasoning about the constants. The debounce and memo are reimplemented
// inline (they mirror packages/ui's debounce.ts and solve-memo.ts, which live in
// packages that don't depend on this one) but createAsyncThrottle is the real thing.
//
// If these numbers change, the client's drag behaviour changed — decide whether that
// was intended before updating the expectations.

const SERVER_LIMIT_PER_100S = 120;
const SLIDER_DEBOUNCE_MS = 150; // packages/ui NumberInput.svelte:28
const MEMO_CAP = 16; // packages/solve solve-memo.ts

/** Mirror of packages/ui/src/lib/utils/debounce.ts — trailing-edge, no maxWait. */
function debounce<T extends (...args: never[]) => void>(fn: T, wait: number) {
	let timer: ReturnType<typeof setTimeout> | null = null;
	return (...args: Parameters<T>) => {
		if (timer !== null) clearTimeout(timer);
		timer = setTimeout(() => {
			fn(...args);
			timer = null;
		}, wait);
	};
}

interface DragOutcome {
	/** Debounce fires that reached the throttle. */
	triggers: number;
	/** Runs that actually hit the network (memo misses). */
	networkCalls: number;
	memoHits: number;
}

/**
 * Drives one simulated drag through the real composition:
 * trailing debounce → createAsyncThrottle (single-in-flight, latest-wins) → LRU memo → network.
 *
 * `moveIntervalMs` is the spacing between pointer moves; `solveRttMs` how long a
 * network solve takes. `distinctValues: false` models dragging back over values
 * already solved, which the memo should absorb.
 */
async function simulateDrag({
	moveIntervalMs,
	durationMs,
	solveRttMs,
	distinctValues = true
}: {
	moveIntervalMs: number;
	durationMs: number;
	solveRttMs: number;
	distinctValues?: boolean;
}): Promise<DragOutcome> {
	let networkCalls = 0;
	let memoHits = 0;
	let triggers = 0;
	const memo: number[] = [];

	const throttle = createAsyncThrottle<number>(async (value) => {
		// The memo is checked INSIDE the throttled run (request-response.ts:29), so a
		// hit serves only after latest-wins ordering has already picked these values.
		if (memo.includes(value)) {
			memoHits++;
			return;
		}
		networkCalls++;
		memo.push(value);
		if (memo.length > MEMO_CAP) memo.shift();
		await new Promise<void>((resolve) => setTimeout(resolve, solveRttMs));
	});

	const commit = debounce((value: number) => {
		triggers++;
		throttle.trigger(value);
	}, SLIDER_DEBOUNCE_MS);

	let seq = 0;
	for (let t = 0; t <= durationMs; t += moveIntervalMs) {
		commit(distinctValues ? ++seq : 1);
		await vi.advanceTimersByTimeAsync(moveIntervalMs);
	}

	// Let the trailing debounce fire and any in-flight/pending run drain.
	await vi.advanceTimersByTimeAsync(SLIDER_DEBOUNCE_MS + solveRttMs * 3);

	return { triggers, networkCalls, memoHits };
}

describe('slider drag → request rate', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('collapses a continuous scrub to a single request', async () => {
		// 16ms frames = a finger moving without pause. The trailing debounce never
		// gets a 150ms gap, so nothing is emitted until release. This is the case the
		// client is genuinely good at, and it is why "drags are fine" feels true.
		const out = await simulateDrag({
			moveIntervalMs: 16,
			durationMs: 30_000,
			solveRttMs: 100
		});

		expect(out.networkCalls).toBe(1);
		expect(out.networkCalls).toBeLessThan(SERVER_LIMIT_PER_100S);
	});

	it('EXCEEDS the server rate limit on ordinary spaced tuning moves', async () => {
		// The regression this file exists for. Moves spaced just past the debounce —
		// someone nudging a slider ~6x/sec to find a value — coalesce into nothing.
		// Every fire starts a request because the fast solve leaves the throttle idle.
		const out = await simulateDrag({
			moveIntervalMs: 160,
			durationMs: 100_000,
			solveRttMs: 50
		});

		expect(out.networkCalls).toBeGreaterThan(SERVER_LIMIT_PER_100S);
		// The user sees `Rate limit reached. Try again in Ns.` long before the drag ends
		// (client cooldown at packages/selva .../library/[guid]/+page.svelte:49-52).
	});

	it('still exceeds the limit at a leisurely two moves per second', async () => {
		// Guards against re-narrowing this to "a pathological ~150ms pattern". The
		// limit IS 1.2/sec, so any spacing under ~830ms overruns it given a fast solve.
		const out = await simulateDrag({
			moveIntervalMs: 500,
			durationMs: 100_000,
			solveRttMs: 50
		});

		expect(out.networkCalls).toBeGreaterThan(SERVER_LIMIT_PER_100S);
	});

	it('is rescued by the throttle only once solves are slower than ~830ms', async () => {
		// The throttle bounds concurrency, so it only becomes the binding constraint
		// when round-trip time alone pushes the rate under 1.2/sec. Anything faster and
		// it never helps — which is what the second wrong analysis missed.
		const slow = await simulateDrag({
			moveIntervalMs: 160,
			durationMs: 100_000,
			solveRttMs: 1000
		});
		expect(slow.networkCalls).toBeLessThan(SERVER_LIMIT_PER_100S);

		const fast = await simulateDrag({
			moveIntervalMs: 160,
			durationMs: 100_000,
			solveRttMs: 500
		});
		expect(fast.networkCalls).toBeGreaterThan(SERVER_LIMIT_PER_100S);
	});

	it('absorbs revisited values in the memo, not the throttle', async () => {
		// Dragging back and forth over already-solved values costs nothing. This — not
		// the throttle — is the second mechanism that keeps normal use under the limit.
		const out = await simulateDrag({
			moveIntervalMs: 160,
			durationMs: 100_000,
			solveRttMs: 50,
			distinctValues: false
		});

		expect(out.networkCalls).toBe(1);
		expect(out.memoHits).toBeGreaterThan(0);
		expect(out.triggers).toBeGreaterThan(out.networkCalls);
	});
});
