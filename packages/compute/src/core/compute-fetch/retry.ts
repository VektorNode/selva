import type { RetryPolicy } from '../types';

const DEFAULT_RETRY: Required<RetryPolicy> = {
	attempts: 0,
	baseDelayMs: 500,
	maxDelayMs: 30_000,
	retryOn429: true
};

const RETRYABLE_STATUS = new Set([502, 503, 504]);

/**
 * Ceiling on a server-sent `Retry-After` wait. The server's window outranks
 * `RetryPolicy.maxDelayMs` (retrying sooner all but guarantees another 429), but a bad or hostile
 * header must not park the client for minutes. A `maxDelayMs` above this cap raises it.
 */
const RETRY_AFTER_CAP_MS = 60_000;

export function resolveRetryPolicy(policy: RetryPolicy | undefined): Required<RetryPolicy> {
	if (!policy) return DEFAULT_RETRY;
	return {
		attempts: policy.attempts ?? DEFAULT_RETRY.attempts,
		baseDelayMs: policy.baseDelayMs ?? DEFAULT_RETRY.baseDelayMs,
		maxDelayMs: policy.maxDelayMs ?? DEFAULT_RETRY.maxDelayMs,
		retryOn429: policy.retryOn429 ?? DEFAULT_RETRY.retryOn429
	};
}

export function isRetryableStatus(status: number, policy: Required<RetryPolicy>): boolean {
	return RETRYABLE_STATUS.has(status) || (policy.retryOn429 && status === 429);
}

/** Delay before the next attempt: the server's `Retry-After` when it sent one, else backoff. */
export function retryDelay(
	retryAfter: string | null,
	attempt: number,
	policy: Required<RetryPolicy>
): number {
	const retryAfterMs = parseRetryAfter(retryAfter);
	return retryAfterMs === null
		? backoffDelay(attempt, policy)
		: Math.min(retryAfterMs, Math.max(policy.maxDelayMs, RETRY_AFTER_CAP_MS));
}

/** A `Retry-After` value (seconds or HTTP-date) in ms; null when missing or unparseable. */
function parseRetryAfter(headerValue: string | null): number | null {
	if (!headerValue) return null;
	const seconds = Number(headerValue);
	if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
	const dateMs = Date.parse(headerValue);
	if (Number.isFinite(dateMs)) {
		const delta = dateMs - Date.now();
		return delta > 0 ? delta : 0;
	}
	return null;
}

export function backoffDelay(attempt: number, policy: Required<RetryPolicy>): number {
	const exponential = policy.baseDelayMs * Math.pow(2, attempt);
	const jitter = Math.random() * policy.baseDelayMs;
	return Math.min(exponential + jitter, policy.maxDelayMs);
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(new DOMException('Aborted', 'AbortError'));
			return;
		}
		const id = setTimeout(() => {
			signal?.removeEventListener('abort', onAbort);
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(id);
			reject(new DOMException('Aborted', 'AbortError'));
		};
		signal?.addEventListener('abort', onAbort, { once: true });
	});
}
