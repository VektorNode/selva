import { untrack } from 'svelte';
import { APP_DEFAULTS } from '../constants';

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
	const { FAST_THRESHOLD_MS, SLOW_THRESHOLD_MS, HISTORY_SIZE, ANIMATION_DELAY } =
		APP_DEFAULTS.SOLVING_INDICATOR;

	let show = $state(false);
	let timeout: ReturnType<typeof setTimeout> | null = null;
	let solveStartTime: number | null = null;
	const solveHistory: number[] = [];

	$effect(() => {
		const solving = isSolving();

		untrack(() => {
			if (solving) {
				solveStartTime = performance.now();

				const avg =
					solveHistory.length === 0
						? Infinity
						: solveHistory.reduce((a, b) => a + b, 0) / solveHistory.length;

				if (solveHistory.length > 0 && avg < FAST_THRESHOLD_MS) return;

				const delay =
					avg === Infinity || avg >= SLOW_THRESHOLD_MS
						? 0
						: ((avg - FAST_THRESHOLD_MS) / (SLOW_THRESHOLD_MS - FAST_THRESHOLD_MS)) *
							ANIMATION_DELAY;

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
				if (solveStartTime !== null) {
					solveHistory.push(performance.now() - solveStartTime);
					if (solveHistory.length > HISTORY_SIZE) solveHistory.shift();
					solveStartTime = null;
				}

				if (timeout) {
					clearTimeout(timeout);
					timeout = null;
				}
				show = false;
			}
		});

		return () => {
			if (timeout) clearTimeout(timeout);
		};
	});

	return {
		get show() {
			return show;
		}
	};
}
