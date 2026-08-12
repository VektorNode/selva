/** Runs `func` once `wait` ms have passed with no further calls. `cancel()` drops a pending call. */
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
