// HTTP hardening helpers — transport-agnostic request/response guards.

export { safeRedirectTarget } from './redirect.js';
export { declaredBodySizeExceeds, type HeadersLike } from './body-size.js';
export { applySecurityHeaders, type SecurityHeaderOptions } from './security-headers.js';
export {
	createRouteClassifier,
	type RouteClassifier,
	type RouteClassifierConfig
} from './route-classifier.js';
