/** `promise`'s outcome, or a rejection with `signal`'s reason if that fires first. */
export function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
	return new Promise((resolve, reject) => {
		const onAbort = () => reject(signal.reason);
		if (signal.aborted) onAbort();
		signal.addEventListener('abort', onAbort, { once: true });
		promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
	});
}
