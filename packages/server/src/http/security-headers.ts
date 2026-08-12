export interface SecurityHeaderOptions {
	/**
	 * Set `Strict-Transport-Security`. Production only — pinning
	 * http://localhost to HTTPS bricks local development. The caller decides
	 * what "production" means (e.g. `NODE_ENV`).
	 */
	hsts: boolean;
}

/**
 * Apply baseline browser-hardening headers to a response and return it for
 * chaining. Each is a cheap win that needs no UI verification:
 *
 *   - X-Content-Type-Options: nosniff — disables MIME sniffing.
 *   - Referrer-Policy: strict-origin-when-cross-origin — strips path and query
 *     from cross-origin Referer headers. Matches modern browser defaults, but
 *     pins the behavior in case a default drifts.
 *   - Permissions-Policy: opts out of browser APIs Selva-engine apps don't use,
 *     so XSS can't enable them.
 *   - HSTS when `opts.hsts`.
 *
 * **Intentionally NOT set here:**
 *   - Content-Security-Policy + frame-ancestors. Selva-engine apps are built
 *     for iframe embedding, so a strict CSP needs validating against real
 *     consumer sites before it can ship.
 *   - X-Frame-Options. Same iframe-embedding constraint.
 *   - Cache-Control. Asset-path layout is app policy; set it in the caller.
 */
export function applySecurityHeaders(response: Response, opts: SecurityHeaderOptions): Response {
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	response.headers.set(
		'Permissions-Policy',
		'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()'
	);
	if (opts.hsts) {
		response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
	}
	return response;
}
