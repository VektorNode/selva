import { Agent, fetch as undiciFetch } from 'undici';

/** undici's default `headersTimeout` and `bodyTimeout`, which `timeoutMs` can't extend. */
const UNDICI_DEFAULT_LIMIT_MS = 300_000;

/** Both off, not raised: the scheduler's `timeoutMs` stays the one deadline on a solve. */
const unlimited = new Agent({ headersTimeout: 0, bodyTimeout: 0 });

// npm undici's own fetch, not the global one: a dispatcher has to match the undici that calls it,
// and Node's bundled copy is a different version.
//
// A call with no signal has no deadline of its own (`getIO` is one), so it keeps undici's limit:
// switching the timeouts off for it would let a hung server hang a page load forever.
const unlimitedFetch = ((input: string, init?: { signal?: AbortSignal }) =>
	undiciFetch(input, {
		...init,
		signal: init?.signal ?? AbortSignal.timeout(UNDICI_DEFAULT_LIMIT_MS),
		dispatcher: unlimited
	})) as unknown as typeof fetch;

/** The fetch for a solve deadline: `undefined` means the global one reaches it. */
export function fetchForDeadline(deadlineMs: number): typeof fetch | undefined {
	return deadlineMs >= UNDICI_DEFAULT_LIMIT_MS ? unlimitedFetch : undefined;
}
