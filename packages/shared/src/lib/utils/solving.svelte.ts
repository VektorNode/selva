import { untrack } from 'svelte';

/**
 * Creates a debounced solving state to prevent flickering of UI indicators
 * for very fast calculations (Rhino Compute).
 *
 * @param isSolving - A function that returns the current solving state
 * @param delayMs - Delay before showing the indicator (default: 800ms)
 * @returns An object with a reactive `show` property
 */
export function createSolvingIndicator(isSolving: () => boolean, delayMs = 800) {
	let show = $state(false);
	let timeout: ReturnType<typeof setTimeout> | null = null;

	$effect(() => {
		const solving = isSolving();

		untrack(() => {
			if (solving) {
				if (!timeout) {
					timeout = setTimeout(() => {
						show = true;
					}, delayMs);
				}
			} else {
				if (timeout) {
					clearTimeout(timeout);
					timeout = null;
				}
				show = false;
			}
		});

		// Cleanup if effect is destroyed
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
