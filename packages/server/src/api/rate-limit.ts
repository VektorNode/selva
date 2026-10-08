/**
 * The general per-token request limit `runHandler` applies to every API-token
 * request. Browser sessions are not charged: their abuse surface is the
 * per-user compute bucket and the login limiter, not request volume.
 *
 * Solves charge this bucket and the owner's `user:{id}` compute bucket, so ten
 * keys of one user never buy ten times the compute.
 *
 * The default limiter is process-local (fixed window over
 * `createComputeRateLimiter`), so N instances admit N times the rate. A host
 * that needs one shared budget implements `ApiRateLimiter` over its own store.
 */

import type { ILogger, RequestContext } from '@selvajs/platform';
import { createComputeRateLimiter } from '../compute/rate-limit.js';
import { readNonNegativeInt, readPositiveInt, type EnvRecord } from '../compute/limits.js';
import { ApiError, ApiErrorCode, toErrorBody } from './errors.js';

export interface ApiRateLimitVerdict {
	allowed: boolean;
	/** Requests admitted per window. */
	limit: number;
	/** Requests left in the current window after this one. */
	remaining: number;
	/** Seconds until the window resets, when refused. */
	retryAfter?: number;
}

/** Records one request against `key`. Async so a shared-store implementation fits. */
export interface ApiRateLimiter {
	hit(key: string): ApiRateLimitVerdict | Promise<ApiRateLimitVerdict>;
}

export interface ApiRateLimitConfig {
	windowMs: number;
	/** `0` disables the limit. */
	maxPerWindow: number;
}

export const DEFAULT_API_RATE_LIMIT: Readonly<ApiRateLimitConfig> = Object.freeze({
	windowMs: 60_000,
	maxPerWindow: 600
});

/**
 * Read `API_TOKEN_RATE_LIMIT_MAX` (requests per window, `0` = off) and
 * `API_TOKEN_RATE_LIMIT_WINDOW_MS` from an injected env map.
 */
export function resolveApiRateLimitConfig(env: EnvRecord, logger?: ILogger): ApiRateLimitConfig {
	return {
		windowMs: readPositiveInt(
			env,
			'API_TOKEN_RATE_LIMIT_WINDOW_MS',
			DEFAULT_API_RATE_LIMIT.windowMs,
			logger
		),
		maxPerWindow: readNonNegativeInt(
			env,
			'API_TOKEN_RATE_LIMIT_MAX',
			DEFAULT_API_RATE_LIMIT.maxPerWindow,
			logger
		)
	};
}

/** Process-local fixed-window limiter. Returns `null` when `maxPerWindow` is 0. */
export function createApiRateLimiter(
	config: ApiRateLimitConfig = DEFAULT_API_RATE_LIMIT
): ApiRateLimiter | null {
	if (config.maxPerWindow <= 0) return null;
	const inner = createComputeRateLimiter(config);
	const limit = config.maxPerWindow;
	return {
		hit(key) {
			const result = inner.check(key);
			return {
				allowed: result.allowed,
				limit,
				remaining: Math.max(0, limit - inner.count(key)),
				retryAfter: result.retryAfter
			};
		}
	};
}

let sharedDefault: ApiRateLimiter | null | undefined;

/**
 * The limiter `depsFromConfig` wires when the host passes none. One per
 * process: deps are rebuilt per request, and a limiter per request counts
 * nothing.
 */
export function defaultApiRateLimiter(): ApiRateLimiter | null {
	if (sharedDefault === undefined) sharedDefault = createApiRateLimiter();
	return sharedDefault;
}

/**
 * Charge one request to the caller's token. `undefined` for a session caller
 * or when no limiter is wired.
 */
export async function chargeApiRateLimit(
	ctx: RequestContext | undefined,
	limiter: ApiRateLimiter | null | undefined
): Promise<ApiRateLimitVerdict | undefined> {
	if (!ctx?.apiScope || !limiter) return undefined;
	return limiter.hit(`token:${ctx.apiScope.tokenId}`);
}

export function rateLimitHeaders(verdict: ApiRateLimitVerdict): Record<string, string> {
	const headers: Record<string, string> = {
		'RateLimit-Limit': String(verdict.limit),
		'RateLimit-Remaining': String(verdict.remaining)
	};
	if (!verdict.allowed) headers['Retry-After'] = String(verdict.retryAfter ?? 1);
	return headers;
}

/** The 429 envelope, with `Retry-After` and the `RateLimit-*` headers. */
export function rateLimitedResponse(
	verdict: ApiRateLimitVerdict,
	message = `Too many requests for this API token. Retry in ${verdict.retryAfter ?? 1}s.`
): Response {
	const retryAfter = String(verdict.retryAfter ?? 1);
	const err = new ApiError(429, ApiErrorCode.RATE_LIMITED, message, undefined, { retryAfter });
	return new Response(JSON.stringify(toErrorBody(err)), {
		status: 429,
		headers: { 'content-type': 'application/json', ...rateLimitHeaders(verdict) }
	});
}

/** Stamp the `RateLimit-*` headers onto a response. No-op without a verdict. */
export function withRateLimitHeaders(
	res: Response,
	verdict: ApiRateLimitVerdict | undefined
): Response {
	if (!verdict) return res;
	const headers = rateLimitHeaders(verdict);
	try {
		for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
		return res;
	} catch {
		// A fetched or otherwise immutable response: rewrap rather than drop the headers.
		const copy = new Headers(res.headers);
		for (const [k, v] of Object.entries(headers)) copy.set(k, v);
		return new Response(res.body, {
			status: res.status,
			statusText: res.statusText,
			headers: copy
		});
	}
}
