import { untrack } from 'svelte';
import { APP_DEFAULTS } from '../constants';

/**
 * Adaptive solving indicator: measures solve durations and adjusts its
 * visibility delay from the running average.
 *
 * - Average under FAST_THRESHOLD_MS: never shown, so quick solves don't flicker
 * - Average over SLOW_THRESHOLD_MS: shown immediately
 * - Between the two: shown after a proportional slice of ANIMATION_DELAY
 * - First solve: shown immediately, there is no history yet
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
