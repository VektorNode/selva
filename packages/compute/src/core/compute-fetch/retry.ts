import type { RetryPolicy } from '../types';

const DEFAULT_RETRY: Required<RetryPolicy> = {
	attempts: 0,
	baseDelayMs: 500,
	maxDelayMs: 30_000,
	retryOn429: true
};

export const RETRYABLE_STATUS = new Set([502, 503, 504]);

/**
 * Absolute ceiling for a server-supplied `Retry-After` wait. The server's
 * stated window wins over `retryPolicy.maxDelayMs` (retrying earlier all but
 * guarantees another 429), but a bad/hostile header must not park the client
 * for minutes — anything above this cap is clamped.
 */
export const RETRY_AFTER_CAP_MS = 60_000;

export function resolveRetryPolicy(policy: RetryPolicy | undefined): Required<RetryPolicy> {
	if (!policy) return DEFAULT_RETRY;
	return {
		attempts: policy.attempts ?? DEFAULT_RETRY.attempts,
		baseDelayMs: policy.baseDelayMs ?? DEFAULT_RETRY.baseDelayMs,
		maxDelayMs: policy.maxDelayMs ?? DEFAULT_RETRY.maxDelayMs,
		retryOn429: policy.retryOn429 ?? DEFAULT_RETRY.retryOn429
	};
}

/**
 * Parse a Retry-After header value (seconds-int or HTTP-date) into ms.
 * Returns null if the header is missing or unparseable.
 */
export function parseRetryAfter(headerValue: string | null): number | null {
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
