/**
 * SvelteKit's form-submission CSRF check, with the two exemptions it can't
 * express. A host turns the framework's own check off and calls this first.
 *
 * - A Selva API key in `Authorization`: a cross-site form can't set the header,
 *   and a `selva_` bearer never falls back to the cookie. API-token uploads are
 *   multipart with no `Origin`, which the framework check refuses. Any other
 *   `Authorization` (a proxy's id token) still gets checked: the request may run
 *   as the cookie session.
 * - `exemptPaths`: endpoints that take a form body from servers, which send no
 *   `Origin` (the OAuth token endpoint, per RFC 6749).
 */

import { API_TOKEN_PREFIX } from '../tokens/index.js';

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
	// Anchored like `resolveApiToken`'s parse: a header that one reads as a key and the
	// other doesn't would skip this check and still run as the cookie session.
	const bearer = /^Bearer\s+(\S+)\s*$/i.exec(request.headers.get('authorization') ?? '')?.[1];
	if (bearer?.startsWith(API_TOKEN_PREFIX)) return false;
	const url = new URL(request.url);
	if (options.exemptPaths?.includes(url.pathname)) return false;
	return request.headers.get('origin') !== url.origin;
}
