export interface SecurityHeaderOptions {
	/**
	 * Set `Strict-Transport-Security` — production only. Locking dev
	 * (http://localhost) into HTTPS would brick local development, so the
	 * caller decides what "production" means (e.g. `NODE_ENV`).
	 */
	hsts: boolean;
}

/**
 * Apply baseline browser-hardening headers to a response. Cheap wins that
 * don't require UI verification:
 *
 *   - X-Content-Type-Options: nosniff — disables MIME sniffing.
 *   - Referrer-Policy: strict-origin-when-cross-origin — strips the path
 *     and query from cross-origin Referer headers; matches modern browser
 *     defaults but pins the behavior in case the default ever drifts.
 *   - Permissions-Policy: opt out of browser APIs Selva-engine apps don't
 *     use, so XSS can't enable them.
 *   - HSTS when `opts.hsts` (production).
 *
 * **Intentionally NOT set here:**
 *   - Content-Security-Policy + frame-ancestors. Selva-engine apps are built
 *     for iframe embedding, so a strict CSP needs UI-phase validation against
 *     real consumer sites before it can ship.
 *   - X-Frame-Options. Same iframe-embedding constraint.
 *   - Cache-Control. Asset-path layout is app policy; set it in the caller.
 *
 * Returns the same response for chaining.
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
