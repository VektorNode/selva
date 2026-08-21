export interface SecurityHeaderOptions {
	/**
	 * Set `Strict-Transport-Security`. Production only — pinning
	 * http://localhost to HTTPS bricks local development. The caller decides
	 * what "production" means (e.g. `NODE_ENV`).
	 */
	hsts: boolean;
	/**
	 * Forbid framing this response. Off by default — Selva-engine app routes are
	 * built to be embedded. Turn it on for operator surfaces (`/admin/*`,
	 * `/setup`), where an authenticated session plus a framable page is a
	 * UI-redress attack. `SameSite=Lax` blunts cross-site POST, not same-origin
	 * redress, so the cookie flag is not a substitute.
	 */
	denyFraming?: boolean;
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
 *   - X-Frame-Options + `frame-ancestors 'none'` when `opts.denyFraming` — the
 *     caller opts in per route, since embeddable app routes must stay framable.
 *
 * **Intentionally NOT set here:**
 *   - A full Content-Security-Policy. Selva-engine apps are built for iframe
 *     embedding, so a strict CSP needs validating against real consumer sites
 *     before it can ship. `denyFraming` sets only the `frame-ancestors`
 *     directive, which constrains nothing else the page loads.
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
	if (opts.denyFraming) {
		response.headers.set('X-Frame-Options', 'DENY');
		response.headers.set('Content-Security-Policy', "frame-ancestors 'none'");
	}
	return response;
}
