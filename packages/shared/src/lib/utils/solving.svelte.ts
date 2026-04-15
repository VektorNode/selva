import { untrack } from 'svelte';
import { APP_DEFAULTS } from '../constants';

// Using centralized thresholds from APP_DEFAULTS

/**
 * Creates an adaptive solving indicator that measures actual solve durations
 * and adjusts its visibility delay accordingly.
 *
 * - Fast solves (<200ms avg): indicator never shown (avoids flicker)
 * - Slow solves (>600ms avg): indicator shown immediately
 * - In between: indicator shown after a proportional delay
 * - First solve: shows immediately (no history yet)
 */
export function createSolvingIndicator(isSolving: () => boolean): { readonly show: boolean } {
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
			if (solveHistory.length > APP_DEFAULTS.SOLVING_INDICATOR.HISTORY_SIZE) {
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

				if (hasHistory && expected < APP_DEFAULTS.SOLVING_INDICATOR.FAST_THRESHOLD_MS) {
					return;
				}

				const delay =
					expected === Infinity || expected >= APP_DEFAULTS.SOLVING_INDICATOR.SLOW_THRESHOLD_MS
						? 0
						: ((expected - APP_DEFAULTS.SOLVING_INDICATOR.FAST_THRESHOLD_MS) /
								(APP_DEFAULTS.SOLVING_INDICATOR.SLOW_THRESHOLD_MS -
									APP_DEFAULTS.SOLVING_INDICATOR.FAST_THRESHOLD_MS)) *
							APP_DEFAULTS.SOLVING_INDICATOR.ANIMATION_DELAY;

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

	const indicator: { readonly show: boolean } = {
		get show() {
			return show;
		}
	};

	return indicator;
}
