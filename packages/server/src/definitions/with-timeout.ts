/**
 * Settles with `work`, or rejects with `onTimeout()` after `ms`. `work` is not cancelled: it runs
 * on, and its later rejection stays handled.
 */
export function withTimeout<T>(work: Promise<T>, ms: number, onTimeout: () => Error): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(onTimeout()), ms);
	});
	return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}
