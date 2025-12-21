/**
 * Throttle utility with trailing edge - limits function execution rate while
 * ensuring the final call is always executed.
 *
 * Perfect for sliders: immediate first call, rate-limited during dragging,
 * guaranteed final value when done.
 *
 * @param func The function to throttle
 * @param limit The minimum time between executions in milliseconds
 * @returns A throttled version of the function
 */
export function throttle<T extends (...args: any[]) => any>(
	func: T,
	limit: number
): (...args: Parameters<T>) => void {
	let inThrottle = false;
	let lastArgs: Parameters<T> | null = null;
	let trailingTimeout: ReturnType<typeof setTimeout> | null = null;

	return function (this: any, ...args: Parameters<T>) {
		lastArgs = args;

		if (!inThrottle) {
			// Execute immediately on first call
			func.apply(this, args);
			inThrottle = true;
			lastArgs = null;

			setTimeout(() => {
				inThrottle = false;
				// Execute with last received args if any were received during throttle
				if (lastArgs !== null) {
					func.apply(this, lastArgs);
					lastArgs = null;
				}
			}, limit);
		} else {
			// Clear existing trailing timeout
			if (trailingTimeout !== null) {
				clearTimeout(trailingTimeout);
			}

			// Schedule trailing call to ensure final value is sent
			// This waits for user to stop changing values
			trailingTimeout = setTimeout(() => {
				if (lastArgs !== null) {
					func.apply(this, lastArgs);
					lastArgs = null;
				}
				trailingTimeout = null;
			}, limit);
		}
	};
}
