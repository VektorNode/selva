import { untrack } from 'svelte';

// How many solves to keep in history for averaging
const HISTORY_SIZE = 3;
// If expected solve time is below this, skip the indicator entirely
const FAST_THRESHOLD_MS = 200;
// If expected solve time is above this, show indicator immediately (no delay)
const SLOW_THRESHOLD_MS = 600;

/**
 * Creates an adaptive solving indicator that measures actual solve durations
 * and adjusts its visibility delay accordingly.
 *
 * - Fast solves (<200ms avg): indicator never shown (avoids flicker)
 * - Slow solves (>600ms avg): indicator shown immediately
 * - In between: indicator shown after a proportional delay
 * - First solve: shows immediately (no history yet)
 */
export function createSolvingIndicator(isSolving: () => boolean) {
	let show = $state(false);
	let timeout: ReturnType<typeof setTimeout> | null = null;

	// Solve duration history
	const solveHistory: number[] = [];
	let solveStartTime: number | null = null;
	let hasHistory = false;

	function getExpectedDuration(): number {
		if (solveHistory.length === 0) return Infinity; // unknown → show immediately
		return solveHistory.reduce((a, b) => a + b, 0) / solveHistory.length;
	}

	function recordSolveEnd() {
		if (solveStartTime !== null) {
			const duration = performance.now() - solveStartTime;
			solveHistory.push(duration);
			if (solveHistory.length > HISTORY_SIZE) {
				solveHistory.shift();
			}
			solveStartTime = null;
			hasHistory = true;
		}
	}

	$effect(() => {
		const solving = isSolving();

		untrack(() => {
			if (solving) {
				solveStartTime = performance.now();

				const expected = getExpectedDuration();

				// Skip indicator entirely for consistently fast solves
				if (hasHistory && expected < FAST_THRESHOLD_MS) {
					return;
				}

				// Delay: 0 for slow/unknown, proportional for mid-range
				const delay =
					expected === Infinity || expected >= SLOW_THRESHOLD_MS
						? 0
						: Math.round(
								((expected - FAST_THRESHOLD_MS) / (SLOW_THRESHOLD_MS - FAST_THRESHOLD_MS)) * 300
							);

				if (!timeout) {
					if (delay === 0) {
						show = true;
					} else {
						timeout = setTimeout(() => {
							show = true;
							timeout = null;
						}, delay);
					}
				}
			} else {
				recordSolveEnd();

				if (timeout) {
					clearTimeout(timeout);
					timeout = null;
				}
				show = false;
			}
		});

		return () => {
			if (timeout) {
				clearTimeout(timeout);
			}
		};
	});

	return {
		get show() {
			return show;
		}
	};
}
