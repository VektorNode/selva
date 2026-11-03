// HTTP hardening helpers — transport-agnostic request/response guards.

export { safeRedirectTarget } from './redirect.js';
export { isCrossSiteFormSubmission, type CsrfOptions } from './csrf.js';
export { declaredBodySizeExceeds, type HeadersLike } from './body-size.js';
export { applySecurityHeaders, type SecurityHeaderOptions } from './security-headers.js';
export {
	createRouteClassifier,
	type RouteClassifier,
	type RouteClassifierConfig
} from './route-classifier.js';
export {
	createLoginRateLimiter,
	addressKeysCollapsed,
	type LoginRateLimiter,
	type LoginRateLimiterConfig
} from './login-rate-limit.js';
export { buildRequestContext, type BuildRequestContextInput } from './request-context.js';
export {
	createBoundedTtlCache,
	type BoundedTtlCache,
	type BoundedTtlCacheConfig
} from './bounded-ttl-cache.js';
export { createSessionRefresher, type SessionRefresher } from './session-refresher.js';
export {
	createHolderVerdictCache,
	resolveApiToken,
	resolveApiTokenSignInWindowMs,
	type ApiTokenResolution,
	type HolderVerdictCache,
	type ResolveApiTokenDeps,
	type ResolveApiTokenOptions
} from './api-token.js';
