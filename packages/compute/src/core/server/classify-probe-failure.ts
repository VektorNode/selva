/**
 * Why a liveness probe failed, and whether waiting can change the answer.
 *
 * `retryable` is the whole point: a powered-off VM and a booting one both read
 * as "offline" from a single probe, but only one of them will ever come up. A
 * caller that can't tell them apart has to assume the optimistic case and burn
 * its full retry window on a machine that is simply off.
 */
export type ProbeVerdict =
	/** Nothing is listening on the port — the host answered, and said no. */
	| 'refused'
	/** The hostname does not resolve. */
	| 'dns'
	/** No answer within the timeout: a booting host swallows packets rather than refusing them. */
	| 'timeout'
	/** The server answered, but rejected the probe's credentials (401/403). */
	| 'unauthorized'
	/** The server answered with a non-2xx that isn't an auth rejection. */
	| 'http_error'
	/** Connection failed in a way we can't attribute. */
	| 'unknown';

export interface ProbeFailure {
	verdict: ProbeVerdict;
	/** Whether retrying the same probe could plausibly succeed later. */
	retryable: boolean;
	/** Operator-facing sentence. Never includes the API key. */
	summary: string;
}

/**
 * `ECONNREFUSED` arrives spelled differently depending on the runtime and how
 * many layers wrapped it: Node puts the code on the error, undici nests it under
 * `cause`, and browsers collapse everything into an opaque "Failed to fetch".
 * Matching the stringified probe error covers all of them without the caller
 * having to normalize first.
 */
const REFUSED_PATTERN = /ECONNREFUSED|ERR_CONNECTION_REFUSED|connection refused/i;
const DNS_PATTERN = /ENOTFOUND|EAI_AGAIN|getaddrinfo|ERR_NAME_NOT_RESOLVED|dns/i;
const TIMEOUT_PATTERN =
	/TimeoutError|ETIMEDOUT|ECONNRESET|EHOSTUNREACH|ENETUNREACH|abort|timed? ?out/i;

/**
 * Classify a {@link ComputeServerStats.probeServer} result.
 *
 * A DNS failure is treated as retryable even though a missing record won't fix
 * itself: `EAI_AGAIN` is a *timeout* talking to the resolver, and the two are
 * not distinguishable from the error alone. Retrying a genuinely-wrong hostname
 * costs one window; giving up on a resolver hiccup breaks a server that is fine.
 *
 * @param probe - The `{ online, status?, error? }` a probe returned. An `online`
 *   probe is not a failure and yields `null`.
 */
export function classifyProbeFailure(probe: {
	online: boolean;
	status?: number;
	error?: string;
}): ProbeFailure | null {
	if (probe.online) return null;

	if (probe.status !== undefined) {
		if (probe.status === 401 || probe.status === 403) {
			return {
				verdict: 'unauthorized',
				retryable: false,
				summary: `The server rejected the liveness probe with HTTP ${probe.status} — check the API key.`
			};
		}
		// 5xx from a proxy in front of a starting child does clear on its own;
		// a 4xx means we asked for something this server will never serve.
		const retryable = probe.status >= 500;
		return {
			verdict: 'http_error',
			retryable,
			summary: retryable
				? `The server answered HTTP ${probe.status} — it may still be starting up.`
				: `The server answered HTTP ${probe.status}, which will not change on retry.`
		};
	}

	const error = probe.error ?? '';

	if (REFUSED_PATTERN.test(error)) {
		return {
			verdict: 'refused',
			retryable: false,
			summary:
				'Connection refused — the host is reachable but nothing is listening on that port. ' +
				'Rhino.Compute is not running, or the URL names the wrong port.'
		};
	}

	if (DNS_PATTERN.test(error)) {
		return {
			verdict: 'dns',
			retryable: true,
			summary: 'The server hostname could not be resolved — check the URL and DNS.'
		};
	}

	if (TIMEOUT_PATTERN.test(error)) {
		return {
			verdict: 'timeout',
			retryable: true,
			summary:
				'No response before the timeout — the machine may be powered off, blocked by a ' +
				'firewall, or still booting.'
		};
	}

	return {
		verdict: 'unknown',
		retryable: true,
		summary: error ? `The connection failed: ${error}` : 'The connection failed.'
	};
}
