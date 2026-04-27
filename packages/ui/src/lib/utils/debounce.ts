/**
 * Debounce utility - delays function execution until after a specified wait time
 * has elapsed since the last time it was invoked.
 *
 * Use for text inputs, search boxes, etc. where you want to wait for the user
 * to finish typing before executing. For sliders, use throttle() instead.
 *
 * @param func The function to debounce
 * @param wait The delay in milliseconds
 * @returns A debounced version of the function with a cancel method
 */
export function debounce<T extends (...args: any[]) => any>(
	func: T,
	wait: number
): ((...args: Parameters<T>) => void) & { cancel: () => void } {
	let timeout: ReturnType<typeof setTimeout> | null = null;

	function debounced(...args: Parameters<T>) {
		if (timeout !== null) {
			clearTimeout(timeout);
		}
		timeout = setTimeout(() => {
			func(...args);
			timeout = null;
		}, wait);
	}

	debounced.cancel = () => {
		if (timeout !== null) {
			clearTimeout(timeout);
			timeout = null;
		}
	};

	return debounced;
}
