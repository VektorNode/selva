/**
 * SvelteKit's form-submission CSRF check, with the two exemptions it can't
 * express. A host turns the framework's own check off and calls this first.
 *
 * - `Authorization` header: a cross-site form can't set one, and a bearer
 *   request never falls back to the cookie. API-token uploads are multipart
 *   with no `Origin`, which the framework check refuses.
 * - `exemptPaths`: endpoints that take a form body from servers, which send no
 *   `Origin` (the OAuth token endpoint, per RFC 6749).
 */

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
// The content types a browser form can send without a CORS preflight, plus
// SvelteKit's own binary form encoding.
const FORM_TYPES = [
	'application/x-www-form-urlencoded',
	'multipart/form-data',
	'text/plain',
	'application/x-sveltekit-formdata'
];

export interface CsrfOptions {
	/** Exact paths that accept cross-site form bodies. */
	exemptPaths?: readonly string[];
}

export function isCrossSiteFormSubmission(request: Request, options: CsrfOptions = {}): boolean {
	if (!UNSAFE_METHODS.has(request.method)) return false;
	const type = (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
	if (!FORM_TYPES.includes(type)) return false;
	if (request.headers.has('authorization')) return false;
	const url = new URL(request.url);
	if (options.exemptPaths?.includes(url.pathname)) return false;
	return request.headers.get('origin') !== url.origin;
}
