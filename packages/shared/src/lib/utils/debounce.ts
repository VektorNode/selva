/**
 * Debounce utility - delays function execution until after a specified wait time
 * has elapsed since the last time it was invoked.
 *
 * Use this for text inputs, search boxes, etc. where you want to wait for user
 * to finish typing before executing.
 *
 * For sliders, use throttle() instead to get immediate feedback with rate limiting.
 *
 * @param func The function to debounce
 * @param wait The delay in milliseconds
 * @returns A debounced version of the function
 */
export function debounce<T extends (...args: any[]) => any>(
	func: T,
	wait: number
): (...args: Parameters<T>) => void {
	let timeout: ReturnType<typeof setTimeout> | null = null;

	return function (this: any, ...args: Parameters<T>) {
		if (timeout !== null) {
			clearTimeout(timeout);
		}

		timeout = setTimeout(() => {
			func.apply(this, args);
			timeout = null;
		}, wait);
	};
}
