import { ASYNC_POLL_WAIT_S, ASYNC_PREFERENCE } from '../shared/async-solve.js';

export const ASYNC_REQUEST_HEADERS = { Prefer: ASYNC_PREFERENCE } as const;

/** A dropped poll is retried this many times in a row before the solve counts as lost. */
const POLL_RETRIES = 3;
const RETRY_DELAY_MS = 1_000;

/**
 * The solve's real response when `res` is a detached solve's 202 (wire format in
 * `shared/async-solve.ts`), or `res` itself when the server answered synchronously. Polls until
 * the solve ends. Null when `signal` aborted first; the server is then told to stop it.
 *
 * @throws when the server stops answering for the solve.
 */
export async function followAsyncSolve(
	res: Response,
	init: { headers: Record<string, string>; signal: AbortSignal; fetch?: typeof fetch }
): Promise<Response | null> {
	if (res.status !== 202 || res.headers.get('Preference-Applied') !== ASYNC_PREFERENCE) return res;
	const location = res.headers.get('Location');
	if (!location) throw new Error('The server accepted the solve but did not say where to wait.');

	const doFetch = init.fetch ?? fetch;
	const poll = new URL(location, res.url || globalThis.location?.href);
	poll.searchParams.set('wait', String(ASYNC_POLL_WAIT_S));
	const cancel = () =>
		void doFetch(location, { method: 'DELETE', headers: init.headers, keepalive: true }).catch(
			() => {}
		);

	let failures = 0;
	for (;;) {
		if (init.signal.aborted) {
			cancel();
			return null;
		}
		let next: Response;
		try {
			next = await doFetch(poll, { headers: init.headers, signal: init.signal, cache: 'no-store' });
		} catch (err) {
			if (init.signal.aborted) {
				cancel();
				return null;
			}
			failures += 1;
			if (failures > POLL_RETRIES) {
				throw new Error('Lost contact with the server while the solve ran. Please try again.', {
					cause: err
				});
			}
			await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * failures));
			continue;
		}
		failures = 0;
		if (next.status !== 202) return next;
		// Drained so the connection can be reused for the next poll.
		await next.body?.cancel().catch(() => {});
	}
}
